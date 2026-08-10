import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AgentAuthService } from '../agent-auth.service';
import { AgentService } from '../agent.service';
import { SettingsService } from '../settings.service';

/**
 * Password help for agents.
 *
 * Sign-in is mobile number + password only — there is no email link and no OTP
 * to verify a reset request with, so a self-serve reset would let anyone who
 * knows an agent's mobile number take the account over. Instead this screen
 * confirms the number is registered and hands the agent straight to the Glaron
 * team, who set a new password from the admin console.
 */
@Component({
  selector: 'app-agent-forgot-password',
  templateUrl: './agent-forgot-password.page.html',
  styleUrls: ['./agent-forgot-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class AgentForgotPasswordPage implements OnInit {
  forgotForm!: FormGroup;
  isLoading = false;
  errorMessage = '';
  // Set once a registered number is confirmed — swaps the form for the
  // "contact us" panel.
  verifiedMobile = '';
  agentName = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private agentAuth: AgentAuthService,
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
    const digits = this.agentAuth.normalizeMobile(value);
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
    const mobile = this.agentAuth.normalizeMobile(this.forgotForm.value.mobile);

    try {
      // Make sure we've seen the real agent list before saying "not found".
      if (!this.agentService.hasSynced) await this.agentService.whenReady(4000);
      const agent = this.agentService.findByMobile(mobile);
      if (!agent) {
        this.errorMessage = 'No agent account is registered with this mobile number. Agent accounts are created by the Glaron team — please check the number they gave you.';
        return;
      }
      this.verifiedMobile = mobile;
      this.agentName = agent.name || '';
    } catch (e) {
      console.error('Agent password help error:', e);
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
      `Hello Glaron India, I need a new password for my agent account (mobile +91 ${this.verifiedMobile}).`
    );
    window.open(`https://wa.me/${wa}?text=${text}`, '_blank');
  }

  tryAnotherNumber() {
    this.verifiedMobile = '';
    this.agentName = '';
    this.forgotForm.reset({ mobile: '' });
  }

  backToLogin() {
    this.router.navigate(['/agent/login']);
  }
}
