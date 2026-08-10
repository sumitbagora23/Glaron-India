import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { APP_VERSION } from '../../version';

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
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false]
    });
  }

  // `remember` decides how long the session lasts: localStorage survives a
  // browser restart, sessionStorage only this tab. Writing both unconditionally
  // made the "Remember me" checkbox do nothing.
  private persistAdminLogin(email: string, remember: boolean) {
    try {
      sessionStorage.setItem('glaron_admin_logged_in', email);
      if (remember) {
        localStorage.setItem('glaron_admin_logged_in', email);
      } else {
        localStorage.removeItem('glaron_admin_logged_in');
      }
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
    const remember = this.loginForm.value.rememberMe === true;

    // Admin developer bypass for local preview and testing
    if (email === 'admin@glaronindia.com' && password === '123456789') {
      this.persistAdminLogin(email, remember);
      setTimeout(() => {
        this.isLoading = false;
        this.router.navigate(['/admin/home']);
      }, 800); // Simulate a fast network response
      return;
    }

    try {
      // Sign in with Firebase Auth
      await signInWithEmailAndPassword(this.auth, email, password);
      this.persistAdminLogin(email, remember);
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
