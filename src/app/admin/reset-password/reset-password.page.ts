import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { Auth, verifyPasswordResetCode, confirmPasswordReset } from '@angular/fire/auth';

@Component({
  selector: 'app-admin-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonSpinner
  ]
})
export class ResetPasswordPage implements OnInit {
  resetForm!: FormGroup;
  showPassword = false;
  showConfirm = false;
  isLoading = false;
  isVerifying = true;
  errorMessage = '';
  successMessage = '';
  accountEmail = '';
  private oobCode = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private auth: Auth
  ) {}

  ngOnInit() {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordsMatch });

    this.oobCode = this.route.snapshot.queryParamMap.get('oobCode') || '';
    if (!this.oobCode) {
      this.isVerifying = false;
      this.errorMessage = 'This password reset link is invalid or missing. Please request a new one.';
      return;
    }

    // Confirm the reset code is valid and fetch the account email
    verifyPasswordResetCode(this.auth, this.oobCode)
      .then(email => {
        this.accountEmail = email;
        this.isVerifying = false;
      })
      .catch(error => {
        console.error('Invalid reset code:', error);
        this.isVerifying = false;
        this.errorMessage = 'This password reset link has expired or already been used. Please request a new one.';
      });
  }

  private passwordsMatch(group: AbstractControl): ValidationErrors | null {
    const pass = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    return pass && confirm && pass !== confirm ? { mismatch: true } : null;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirm() {
    this.showConfirm = !this.showConfirm;
  }

  async onSubmit() {
    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    const { password } = this.resetForm.value;

    try {
      await confirmPasswordReset(this.auth, this.oobCode, password);
      this.successMessage = 'Your password has been reset successfully. Redirecting to sign in...';
      setTimeout(() => this.router.navigate(['/admin/login']), 2200);
    } catch (error: any) {
      console.error('Password reset error:', error);
      if (error.code === 'auth/weak-password') {
        this.errorMessage = 'Please choose a stronger password (at least 6 characters).';
      } else if (error.code === 'auth/expired-action-code' || error.code === 'auth/invalid-action-code') {
        this.errorMessage = 'This reset link has expired or already been used. Please request a new one.';
      } else {
        this.errorMessage = 'Could not reset your password. Please try again.';
      }
    } finally {
      this.isLoading = false;
    }
  }

  backToLogin() {
    this.router.navigate(['/admin/login']);
  }
}
