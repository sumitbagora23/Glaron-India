import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { DealerAuthService } from '../dealer-auth.service';
import { DealerService } from '../admin/dealer.service';
import { AgentService } from '../agent.service';
import { SettingsService } from '../admin/settings.service';

/**
 * Password help — for every account that can sign in to this app.
 *
 * Sign-in is mobile number + password only — there is no email link and no OTP
 * to verify a reset request with, so a self-serve reset would let anyone who
 * knows someone's mobile number take the account over. Instead this screen
 * confirms the number is registered and hands the person straight to the Glaron
 * team, who set a new password from the admin panel.
 *
 * Both account lists are searched, for the same reason the sign-in form checks
 * both: there is one app and one shared set of screens, so a number that is not
 * a dealer's must still be recognised here rather than reported as unknown.
 */
@Component({
  selector: 'app-dealer-forgot-password',
  templateUrl: './dealer-forgot-password.page.html',
  styleUrls: ['./dealer-forgot-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class DealerForgotPasswordPage implements OnInit {
  forgotForm!: FormGroup;
  isLoading = false;
  errorMessage = '';
  // Set once a registered number is confirmed — swaps the form for the
  // "contact us" panel.
  verifiedMobile = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private dealerAuth: DealerAuthService,
    private dealerService: DealerService,
    private agentService: AgentService,
    private settings: SettingsService
  ) {}

  ngOnInit() {
    this.forgotForm = this.fb.group({
      mobile: ['', [Validators.required, Validators.pattern('^[6-9][0-9]{9}$')]]
    });
  }

  // The Glaron support number the admin configures in Settings.
  get supportNumber(): string {
    return (this.settings.settings.callNumber || '').trim();
  }

  private get supportDigits(): string {
    return this.supportNumber.replace(/[^\d]/g, '');
  }

  onMobileInput(value: string) {
    const digits = this.dealerAuth.normalizeMobile(value);
    if (digits !== value) {
      this.forgotForm.get('mobile')?.setValue(digits, { emitEvent: false });
    }
  }

  async onSubmit() {
    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const mobile = this.dealerAuth.normalizeMobile(this.forgotForm.value.mobile);

    try {
      // Make sure we've seen the real lists before saying "not found".
      if (!this.dealerService.hasSynced) await this.dealerService.whenReady(4000);
      let found = !!this.dealerService.findByMobile(mobile);

      if (!found) {
        if (!this.agentService.hasSynced) await this.agentService.whenReady(4000);
        found = !!this.agentService.findByMobile(mobile);
      }

      if (!found) {
        this.errorMessage = 'No account is registered with this mobile number. Please check the number, or register from the login screen.';
        return;
      }
      this.verifiedMobile = mobile;
    } catch (e) {
      console.error('Dealer password help error:', e);
      this.errorMessage = 'Could not check that number right now. Please check your connection and try again.';
    } finally {
      this.isLoading = false;
    }
  }

  callSupport() {
    const digits = this.supportDigits;
    if (!digits) return;
    window.location.href = `tel:${digits}`;
  }

  whatsappSupport() {
    const digits = this.supportDigits;
    if (!digits) return;
    // Indian numbers stored without a country code still need one for wa.me.
    const wa = digits.length === 10 ? '91' + digits : digits;
    const text = encodeURIComponent(
      `Hello Glaron India, I need a new password for my account (mobile +91 ${this.verifiedMobile}).`
    );
    window.open(`https://wa.me/${wa}?text=${text}`, '_blank');
  }

  tryAnotherNumber() {
    this.verifiedMobile = '';
    this.forgotForm.reset({ mobile: '' });
  }

  backToLogin() {
    this.router.navigate(['/dealer/login']);
  }
}
