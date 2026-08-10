import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { PostService, SharePost } from '../post.service';

/**
 * Share Posts — its own sidebar tab.
 *
 * Lists every post live on the dealer home tab, newest first. Publishing a new
 * one opens its own full page (see PostFormPage).
 */
@Component({
  selector: 'app-admin-posts',
  templateUrl: './posts.page.html',
  styleUrls: ['./posts.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class PostsPage implements OnInit {
  constructor(
    private postService: PostService,
    private router: Router
  ) {}

  ngOnInit() {
    this.postService.start();
  }

  // Live feed from Firestore.
  get posts(): SharePost[] {
    return this.postService.posts;
  }

  trackById(_index: number, post: SharePost): string {
    return post.id;
  }

  addPost() {
    this.router.navigate(['/admin/posts/new']);
  }

  removePost(post: SharePost, event: Event) {
    event.stopPropagation();
    if (!confirm('Delete this post? It disappears from the dealer home tab right away.')) return;
    this.postService.remove(post.id);
  }

  // A short human-readable "time ago" label.
  timeAgo(ts: number): string {
    const diff = Date.now() - (ts || 0);
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return mins + (mins === 1 ? ' min ago' : ' mins ago');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
}
