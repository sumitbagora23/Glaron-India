import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';
import { LIGHT_COLOUR_OPTIONS, NO_COLOUR } from './light-colours';

export interface LightColour {
  id: string;
  name: string;
  // Display order (lower first). Falls back to alphabetical when equal/missing.
  order?: number;
  createdAt?: string;
}

/**
 * The shades a product can be ordered in, managed by the admin.
 *
 * Same shape as CategoryService: a Firestore collection mirrored into a signal,
 * with localStorage as the offline fallback so the product form still has its
 * options on a cold start. The collection is seeded once from
 * LIGHT_COLOUR_OPTIONS when it is empty.
 *
 * Products store the shade NAME, not an id — that is what the dealer, agent and
 * public catalogue cards render. So the manage page renames a colour on every
 * product carrying it (renameOn / removeFrom in the page), rather than leaving
 * the old string behind.
 *
 * "No Colour" is never one of these. It is not a shade an admin picks or edits,
 * it is what the product form writes when the picker is cleared — so it is kept
 * out of the seed and stripped on read, in case an earlier version of this
 * service (or a hand-added document) put it in the collection.
 */
@Injectable({
  providedIn: 'root'
})
export class LightColourService {
  private STORAGE_KEY = 'glaron_light_colours_v1';
  private firestore = inject(Firestore, { optional: true });

  private coloursSignal = signal<LightColour[]>(this.loadFromStorage());

  constructor() {
    this.initFirestoreSync();
  }

  private slugify(name: string): string {
    return (name || 'colour').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'colour';
  }

  private buildDefaults(): LightColour[] {
    return LIGHT_COLOUR_OPTIONS.map((name, i) => ({
      id: this.slugify(name),
      name,
      order: i + 1
    }));
  }

  // "No Colour" is the product form's own value for a cleared picker, not a
  // shade. It never belongs in the list an admin reads or edits.
  private withoutNoColour(list: LightColour[]): LightColour[] {
    return list.filter(c => (c.name || '').trim().toLowerCase() !== NO_COLOUR.toLowerCase());
  }

  // Every path into the signal goes through here, so the filter above only has
  // to be applied in one place.
  private sortColours(list: LightColour[]): LightColour[] {
    return this.withoutNoColour(list).sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'lightColours');
      onSnapshot(col, (snapshot) => {
        if (snapshot.empty) {
          // Seed the shades the range shipped with, once, when nothing is there.
          this.buildDefaults().forEach(c => {
            if (this.firestore) setDoc(doc(this.firestore, 'lightColours', c.id), c).catch(() => {});
          });
          return;
        }
        const list: LightColour[] = [];
        snapshot.forEach(docSnap => list.push(docSnap.data() as LightColour));

        // Shades added to the seed after this collection was first written
        // would otherwise never appear: the block above only fires on an empty
        // collection. Anything in the seed and not here is added; nothing is
        // ever removed or renamed, so an admin's own edits are left alone.
        const present = new Set(list.map(c => (c.name || '').trim().toLowerCase()));
        const missing = this.buildDefaults().filter(c => !present.has(c.name.trim().toLowerCase()));
        if (missing.length) {
          let order = list.reduce((max, c) => Math.max(max, Number(c.order) || 0), 0);
          missing.forEach(c => {
            const added = { ...c, order: ++order };
            list.push(added);
            if (this.firestore) setDoc(doc(this.firestore, 'lightColours', added.id), added).catch(() => {});
          });
        }

        const sorted = this.sortColours(list);
        this.coloursSignal.set(sorted);
        this.saveToStorage(sorted);
      }, (err) => {
        console.warn('Firestore light colours notice (using local fallback):', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore light colours init notice:', e);
    }
  }

  private loadFromStorage(): LightColour[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed: LightColour[] = JSON.parse(stored);
        if (parsed && parsed.length) return this.sortColours(parsed);
      }
    } catch (e) {
      console.error('Error loading light colours from localStorage', e);
    }
    // First run: show the seeded shades immediately (Firestore seeding follows).
    const defaults = this.buildDefaults();
    this.saveToStorage(defaults);
    return defaults;
  }

  private saveToStorage(colours: LightColour[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(colours));
    } catch (e) {
      console.error('Error saving light colours to localStorage', e);
    }
  }

  get colours(): LightColour[] {
    return this.coloursSignal();
  }

  // What the product form's dropdown lists — the names, in admin order.
  get names(): string[] {
    return this.coloursSignal().map(c => c.name);
  }

  getColourById(id: string): LightColour | undefined {
    return this.coloursSignal().find(c => c.id === id);
  }

  // A shade is its name, so two of the same name would be one option listed
  // twice. Ignores case and stray spacing; skipId lets a rename keep its own.
  nameTaken(name: string, skipId?: string): boolean {
    const wanted = (name || '').trim().toLowerCase();
    return this.coloursSignal().some(c => c.id !== skipId && c.name.trim().toLowerCase() === wanted);
  }

  // Rejects (rather than resolves) when the Firestore write fails, so the page
  // can tell the admin the shade never reached the other devices.
  addColour(name: string): Promise<void> {
    const id = `${this.slugify(name)}-${Date.now()}`;
    const maxOrder = this.coloursSignal().reduce((m, c) => Math.max(m, c.order ?? 0), 0);
    const colour: LightColour = {
      id,
      name: name.trim(),
      order: maxOrder + 1,
      createdAt: new Date().toISOString()
    };

    this.coloursSignal.update(list => {
      const newList = this.sortColours([...list, colour]);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'lightColours', id), colour);
    }
    return Promise.resolve();
  }

  updateColour(updated: LightColour): Promise<void> {
    this.coloursSignal.update(list => {
      const newList = this.sortColours(list.map(c => c.id === updated.id ? { ...c, ...updated } : c));
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'lightColours', updated.id), updated);
    }
    return Promise.resolve();
  }

  deleteColour(id: string): Promise<void> {
    this.coloursSignal.update(list => {
      const newList = list.filter(c => c.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return deleteDoc(doc(this.firestore, 'lightColours', id));
    }
    return Promise.resolve();
  }

  // Swap two shades' places in the list the product form shows.
  move(id: string, direction: -1 | 1): Promise<void> {
    const list = this.coloursSignal();
    const index = list.findIndex(c => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return Promise.resolve();

    // Written back as 1..n so a list seeded without order values still lands
    // in a defined sequence rather than drifting on the alphabetical fallback.
    const reordered = [...list];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const numbered = reordered.map((c, i) => ({ ...c, order: i + 1 }));

    this.coloursSignal.set(numbered);
    this.saveToStorage(numbered);

    if (this.firestore) {
      return Promise.all(
        numbered.map(c => setDoc(doc(this.firestore!, 'lightColours', c.id), c))
      ).then(() => undefined);
    }
    return Promise.resolve();
  }
}
