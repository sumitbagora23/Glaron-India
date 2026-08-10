import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';

export interface Category {
  id: string;
  name: string;
  // Downscaled image stored inline as a data URL (same approach as products),
  // so no Firebase Storage setup is required.
  image?: string;
  // Display order (lower first). Falls back to alphabetical when equal/missing.
  order?: number;
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CategoryService {
  private STORAGE_KEY = 'glaron_categories_v1';
  private firestore = inject(Firestore, { optional: true });

  // Initial category set. Images are left blank to be uploaded manually later.
  private defaultCategoryNames = [
    'Flood',
    'Street',
    'Solar',
    'COB',
    'Concealed',
    'Panel',
    'Surface',
    'Cylinder',
    'Wall Light',
    'Foot Light',
    'Gate Light',
    'Rope & Striped Light',
    'Track Light'
  ];

  private categoriesSignal = signal<Category[]>(this.loadFromStorage());

  constructor() {
    this.initFirestoreSync();
  }

  private slugify(name: string): string {
    return (name || 'category').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
  }

  private buildDefaults(): Category[] {
    return this.defaultCategoryNames.map((name, i) => ({
      id: this.slugify(name),
      name,
      order: i + 1
    }));
  }

  private sortCategories(list: Category[]): Category[] {
    return [...list].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'categories');
      onSnapshot(col, (snapshot) => {
        if (snapshot.empty) {
          // Seed the initial categories once when the collection is empty.
          this.buildDefaults().forEach(c => {
            if (this.firestore) setDoc(doc(this.firestore, 'categories', c.id), c).catch(() => {});
          });
          return;
        }
        const list: Category[] = [];
        snapshot.forEach(docSnap => list.push(docSnap.data() as Category));
        const sorted = this.sortCategories(list);
        this.categoriesSignal.set(sorted);
        this.saveToStorage(sorted);
      }, (err) => {
        console.warn('Firestore categories notice (using local fallback):', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore categories init notice:', e);
    }
  }

  private loadFromStorage(): Category[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed: Category[] = JSON.parse(stored);
        if (parsed && parsed.length) return this.sortCategories(parsed);
      }
    } catch (e) {
      console.error('Error loading categories from localStorage', e);
    }
    // First run: show the default set immediately (Firestore seeding follows).
    const defaults = this.buildDefaults();
    this.saveToStorage(defaults);
    return defaults;
  }

  private saveToStorage(categories: Category[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(categories));
    } catch (e) {
      console.error('Error saving categories to localStorage', e);
    }
  }

  get categories(): Category[] {
    return this.categoriesSignal();
  }

  getCategoryById(id: string): Category | undefined {
    return this.categoriesSignal().find(c => c.id === id);
  }

  // Returns a promise that rejects if the Firestore write fails (e.g. the image
  // pushes the document past Firestore's 1 MB limit) so the caller can tell the
  // admin the save didn't sync, instead of the failure being swallowed.
  addCategory(data: { name: string; image?: string }): Promise<void> {
    const id = `${this.slugify(data.name)}-${Date.now()}`;
    const maxOrder = this.categoriesSignal().reduce((m, c) => Math.max(m, c.order ?? 0), 0);
    const category: Category = {
      id,
      name: data.name.trim(),
      image: data.image,
      order: maxOrder + 1,
      createdAt: new Date().toISOString()
    };

    this.categoriesSignal.update(list => {
      const newList = this.sortCategories([...list, category]);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'categories', id), category);
    }
    return Promise.resolve();
  }

  updateCategory(updated: Category): Promise<void> {
    this.categoriesSignal.update(list => {
      const newList = this.sortCategories(list.map(c => c.id === updated.id ? { ...c, ...updated } : c));
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'categories', updated.id), updated);
    }
    return Promise.resolve();
  }

  deleteCategory(id: string) {
    this.categoriesSignal.update(list => {
      const newList = list.filter(c => c.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'categories', id))
        .catch(err => console.warn('Firestore delete category notice:', err?.message || err));
    }
  }
}
