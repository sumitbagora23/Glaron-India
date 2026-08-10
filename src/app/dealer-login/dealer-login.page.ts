import { Component, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { DealerAuthService } from '../dealer-auth.service';
import { DealerApprovalService } from '../dealer-approval.service';
import { AgentAuthService } from '../agent-auth.service';
import { NotificationService } from '../admin/notification.service';
import { APP_VERSION } from '../version';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-dealer-login',
  templateUrl: './dealer-login.page.html',
  styleUrls: ['./dealer-login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class DealerLoginPage implements OnInit, OnDestroy {
  loginForm!: FormGroup;
  showPassword = false;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  readonly appVersion = APP_VERSION;
  private routerSub?: Subscription;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private dealerAuth: DealerAuthService,
    private agentAuth: AgentAuthService,
    private approval: DealerApprovalService,
    private notifications: NotificationService
  ) {
    // The instant the admin approves this device's pending dealer, surface the
    // "approval accepted" banner live — the dealer doesn't need to reload.
    effect(() => {
      if (this.approval.justApproved()) this.showApprovalBanner();
    });
  }

  ngOnInit() {
    // Start listening for broadcasts (and request notification permission on the
    // first tap) so a waiting applicant can also get the OS approval push.
    this.notifications.startDealerListener();
    // Warm up the anonymous Firebase session that Firestore writes ride on, so
    // registering / ordering later doesn't wait on it.
    this.dealerAuth.ensureFirebaseSession();

    // Build the form once; entry-time logic lives in ionViewWillEnter so it also
    // runs when Ionic reuses this page instance (see below).
    this.loginForm = this.fb.group({
      mobile: ['', [Validators.required, Validators.pattern('^[6-9][0-9]{9}$')]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [true]
    });
    this.initLoginState();

    // Ionic keeps pages alive in the router-outlet stack and reuses this instance
    // when a dealer signs out and returns to the login screen. Neither ngOnInit
    // nor Ionic's ionViewWillEnter fire reliably on a reused instance, which left
    // the previous dealer's mobile/password sitting in the form. Angular's
    // NavigationEnd fires on every navigation regardless of reuse — use it to
    // re-check the session and reset the form each time login is (re-)entered.
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        if (e.urlAfterRedirects.includes('/dealer/login')) {
          this.initLoginState();
        }
      });
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }

  // Kept for the cases where Ionic does fire it; NavigationEnd above is primary.
  ionViewWillEnter() {
    this.initLoginState();
  }

  private initLoginState() {
    // Already signed in on this device → skip login and open whichever panel
    // this account belongs to. One app, two kinds of account: the session that
    // exists decides where the person lands.
    if (this.dealerAuth.getSession()) {
      this.router.navigate(['/dealer/catalog']);
      return;
    }
    if (this.agentAuth.getSession()) {
      this.router.navigate(['/agent/panel']);
      return;
    }

    // Clear any credentials/messages left over from a previous dealer's session.
    this.isLoading = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.showPassword = false;
    this.loginForm?.reset({ mobile: '', password: '', rememberMe: true });

    // If this device's dealer was approved (now or while the app was closed),
    // keep showing the accepted banner until they sign in.
    if (this.approval.hasApprovedMessage()) this.showApprovalBanner();
  }

  // Show the "approval accepted" success banner on the login form.
  private showApprovalBanner() {
    const label = this.approval.approvedLabel();
    this.errorMessage = '';
    this.successMessage = `🎉 Approval accepted${label ? ', ' + label : ''}! Your dealer account is now active — please sign in.`;
  }

  // Keep only digits in the mobile field as the dealer types, so a pasted
  // "+91 98765 43210" still validates.
  onMobileInput(value: string) {
    const digits = this.dealerAuth.normalizeMobile(value);
    if (digits !== value) {
      this.loginForm.get('mobile')?.setValue(digits, { emitEvent: false });
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const mobile = this.dealerAuth.normalizeMobile(this.loginForm.value.mobile);
    const password = this.loginForm.value.password;
    // Unchecked "Remember me" keeps the session for this run of the app only.
    const remember = this.loginForm.value.rememberMe !== false;

    try {
      const result = await this.dealerAuth.login(mobile, password);

      switch (result.status) {
        case 'ok':
          this.dealerAuth.persistSession(mobile, remember);
          this.approval.clearPending();
          // Firestore writes (orders, profile edits) need an authenticated
          // caller; take the anonymous session now that they're in.
          this.dealerAuth.ensureFirebaseSession();
          this.successMessage = 'Signed in successfully!';
          this.router.navigate(['/dealer/catalog']);
          break;

        case 'pending':
          // Remember this number so we can announce approval the moment it lands.
          this.approval.markPending(mobile);
          this.errorMessage = 'Your registration is complete and is waiting for admin approval. You will be able to log in once your account is approved.';
          break;

        case 'not-found':
          // Not a dealer — the same number and password may belong to a sales
          // account instead. One sign-in form serves both, so the fall-through
          // happens here rather than sending anyone to a second app.
          //
          // Only 'not-found' falls through: a recognised number with the wrong
          // password must fail as itself, or a typo'd dealer password would be
          // re-tried against every other account list and report the wrong
          // reason.
          await this.tryOtherAccountType(mobile, password, remember);
          break;

        case 'wrong-password':
          this.errorMessage = 'Incorrect password. Please try again, or tap "Forgot password?" for help.';
          break;

        case 'no-password':
          this.errorMessage = 'This account was created before mobile sign-in and has no password yet. Please contact the Glaron team to set one.';
          break;
      }
    } catch (error: any) {
      console.error('Sign-in error:', error);
      this.errorMessage = 'Could not sign you in right now. Please check your connection and try again.';
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Second pass for a number no dealer record claims: try it as a sales
   * account. Reports the failure in the caller's own words if that misses too,
   * so an unknown number never leaks which of the two lists was searched.
   */
  private async tryOtherAccountType(mobile: string, password: string, remember = true) {
    const result = await this.agentAuth.login(mobile, password);

    switch (result.status) {
      case 'ok':
        this.agentAuth.persistSession(mobile, remember);
        this.agentAuth.ensureFirebaseSession();
        this.successMessage = 'Signed in successfully!';
        this.router.navigate(['/agent/panel']);
        break;

      case 'inactive':
        this.errorMessage = 'This account is currently inactive. Please contact the Glaron team.';
        break;

      case 'wrong-password':
        this.errorMessage = 'Incorrect password. Please try again, or tap "Forgot password?" for help.';
        break;

      case 'no-password':
        this.errorMessage = 'No password has been set on this account yet. Please contact the Glaron team.';
        break;

      case 'not-found':
        this.errorMessage = 'No account found for this mobile number. Please check the number, or tap "Create an account" to register.';
        break;
    }
  }

  onApplyHere() {
    this.router.navigate(['/dealer/apply']);
  }

  onForgotPassword() {
    this.router.navigate(['/dealer/forgot-password']);
  }
}
