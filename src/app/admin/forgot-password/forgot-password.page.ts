import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { Auth, sendPasswordResetEmail } from '@angular/fire/auth';

@Component({
  selector: 'app-admin-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonSpinner
  ]
})
export class ForgotPasswordPage implements OnInit {
  forgotForm!: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private auth: Auth
  ) {}

  ngOnInit() {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  async onSubmit() {
    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    const { email } = this.forgotForm.value;

    try {
      await sendPasswordResetEmail(this.auth, email);
      this.successMessage = `A password reset link has been sent to ${email}. Please check your inbox.`;
    } catch (error: any) {
      console.error('Password reset error:', error);
      if (error.code === 'auth/user-not-found') {
        this.errorMessage = 'No admin account found with that email address.';
      } else if (error.code === 'auth/invalid-email') {
        this.errorMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        this.errorMessage = 'Too many attempts. Please try again later.';
      } else {
        this.errorMessage = 'Could not send the reset link. Please check your connection and try again.';
      }
    } finally {
      this.isLoading = false;
    }
  }

  backToLogin() {
    this.router.navigate(['/admin/login']);
  }
}
