import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CategoryService, Category } from '../category.service';

@Component({
  selector: 'app-admin-categories',
  templateUrl: './categories.page.html',
  styleUrls: ['./categories.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class CategoriesPage {
  constructor(
    private router: Router,
    private categoryService: CategoryService
  ) {}

  get categories(): Category[] {
    return this.categoryService.categories;
  }

  trackByCategoryId(_index: number, category: Category): string {
    return category.id;
  }

  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  addCategory() {
    this.router.navigate(['/admin/categories/new']);
  }

  editCategory(category: Category) {
    this.router.navigate(['/admin/categories/edit', category.id]);
  }

  deleteCategory(category: Category, event?: Event) {
    if (event) event.stopPropagation();
    if (confirm(`Delete category "${category.name}"? This cannot be undone.`)) {
      this.categoryService.deleteCategory(category.id);
    }
  }
}
