import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  // Store the active search keyword
  searchKeyword = signal('');
  
  // Set search keyword helper
  setKeyword(val: string) {
    this.searchKeyword.set(val);
  }

  // Clear search keyword
  clear() {
    this.searchKeyword.set('');
  }
}
