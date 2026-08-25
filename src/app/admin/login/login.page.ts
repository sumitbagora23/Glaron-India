import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { APP_VERSION } from '../../version';
import { isAdminEmail, getAdminPassword } from '../admin-credentials';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonSpinner
  ]
})
export class LoginPage implements OnInit {
  loginForm!: FormGroup;
  showPassword = false;
  isLoading = false;
  errorMessage = '';
  readonly appVersion = APP_VERSION;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private auth: Auth
  ) {}

  ngOnInit() {
    // Already signed in on this device → go straight to dashboard
    let existing = '';
    try {
      existing = localStorage.getItem('glaron_admin_logged_in') || sessionStorage.getItem('glaron_admin_logged_in') || '';
    } catch (e) {}
    if (existing) {
      this.router.navigate(['/admin/home']);
      return;
    }

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  // The console stays signed in on this device until the user explicitly signs
  // out. The token goes to localStorage, which survives closing the installed
  // PWA — sessionStorage does not, and writing only there was why reopening the
  // app kept landing back on the login screen. sessionStorage is written too so
  // the current tab is covered without waiting on a storage read.
  private persistAdminLogin(email: string) {
    try {
      localStorage.setItem('glaron_admin_logged_in', email);
      sessionStorage.setItem('glaron_admin_logged_in', email);
    } catch (e) {}
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  goToForgotPassword() {
    this.router.navigate(['/admin/forgot-password']);
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const { email, password } = this.loginForm.value;

    // The single admin account signs in against the password stored on this
    // device (the built-in default, or whatever was last set on the "Recreate
    // password" screen) — no network needed.
    if (isAdminEmail(email) && password === getAdminPassword()) {
      this.persistAdminLogin(email);
      setTimeout(() => {
        this.isLoading = false;
        this.router.navigate(['/admin/home']);
      }, 800); // Simulate a fast network response
      return;
    }

    try {
      // Sign in with Firebase Auth
      await signInWithEmailAndPassword(this.auth, email, password);
      this.persistAdminLogin(email);
      // On success, navigate to the admin dashboard
      this.router.navigate(['/admin/home']);
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        this.errorMessage = 'Invalid email or password. Please try again.';
      } else if (error.code === 'auth/too-many-requests') {
        this.errorMessage = 'Too many failed login attempts. Please try again later.';
      } else {
        this.errorMessage = 'An error occurred during login. Please check your internet connection.';
      }
    } finally {
      this.isLoading = false;
    }
  }
}
