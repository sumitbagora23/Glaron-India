import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { ADMIN_EMAIL, isAdminEmail, setAdminPassword } from '../admin-credentials';

/**
 * Recreate the admin password — self-serve, no email link.
 *
 * The console is a single account (admin@glaronindia.com), so the old "we've
 * emailed you a reset link" flow was a dead end: no message ever arrived. This
 * screen sets a new password directly on the device instead. Only the admin
 * email is accepted; every later sign-in checks against the password saved here.
 */
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
  showPassword = false;
  showConfirm = false;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  readonly adminEmail = ADMIN_EMAIL;

  constructor(
    private fb: FormBuilder,
    private router: Router
  ) {}

  ngOnInit() {
    this.forgotForm = this.fb.group({
      email: [ADMIN_EMAIL, [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordsMatch });
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

  onSubmit() {
    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    const { email, password } = this.forgotForm.value;

    // Only the admin account can be reset here.
    if (!isAdminEmail(email)) {
      this.errorMessage = `Password reset is only available for the admin account (${ADMIN_EMAIL}).`;
      return;
    }

    this.isLoading = true;
    // Small delay purely so the button shows feedback before we swap to success.
    setTimeout(() => {
      setAdminPassword(password);
      this.isLoading = false;
      this.successMessage = 'Your admin password has been reset. Redirecting to sign in...';
      setTimeout(() => this.router.navigate(['/admin/login']), 1900);
    }, 500);
  }

  backToLogin() {
    this.router.navigate(['/admin/login']);
  }
}
