import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AgentAuthService } from '../agent-auth.service';
import { APP_VERSION } from '../version';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-agent-login',
  templateUrl: './agent-login.page.html',
  styleUrls: ['./agent-login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class AgentLoginPage implements OnInit, OnDestroy {
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
    private agentAuth: AgentAuthService
  ) {}

  ngOnInit() {
    // Warm up the anonymous Firebase session Firestore access rides on.
    this.agentAuth.ensureFirebaseSession();

    this.loginForm = this.fb.group({
      mobile: ['', [Validators.required, Validators.pattern('^[6-9][0-9]{9}$')]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [true]
    });
    this.initLoginState();

    // Ionic keeps pages alive in the router-outlet stack and reuses this
    // instance when an agent signs out and returns here — neither ngOnInit nor
    // ionViewWillEnter fire reliably on a reused instance, which would leave the
    // previous agent's credentials sitting in the form. NavigationEnd always
    // fires, so it drives the reset.
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        if (e.urlAfterRedirects.includes('/agent/login')) {
          this.initLoginState();
        }
      });
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }

  ionViewWillEnter() {
    this.initLoginState();
  }

  private initLoginState() {
    // Already signed in on this device → skip login and open the panel.
    if (this.agentAuth.getSession()) {
      this.router.navigate(['/agent/panel']);
      return;
    }

    this.isLoading = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.showPassword = false;
    this.loginForm?.reset({ mobile: '', password: '', rememberMe: true });
  }

  // Keep only digits in the mobile field as the agent types, so a pasted
  // "+91 98765 43210" still validates.
  onMobileInput(value: string) {
    const digits = this.agentAuth.normalizeMobile(value);
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

    const mobile = this.agentAuth.normalizeMobile(this.loginForm.value.mobile);
    const password = this.loginForm.value.password;

    try {
      const result = await this.agentAuth.login(mobile, password);

      switch (result.status) {
        case 'ok':
          this.agentAuth.persistSession(mobile);
          this.agentAuth.ensureFirebaseSession();
          this.successMessage = 'Signed in successfully!';
          this.router.navigate(['/agent/panel']);
          break;

        case 'inactive':
          this.errorMessage = 'This agent account is currently inactive. Please contact the Glaron team.';
          break;

        case 'not-found':
          this.errorMessage = 'No agent account found for this mobile number. Agent accounts are created by the Glaron team — please check the number they gave you.';
          break;

        case 'wrong-password':
          this.errorMessage = 'Incorrect password. Please try again, or tap "Forgot password?" for help.';
          break;

        case 'no-password':
          this.errorMessage = 'No password has been set on this account yet. Please contact the Glaron team.';
          break;
      }
    } catch (error: any) {
      console.error('Agent login error:', error);
      this.errorMessage = 'Could not sign you in right now. Please check your connection and try again.';
    } finally {
      this.isLoading = false;
    }
  }

  onForgotPassword() {
    this.router.navigate(['/agent/forgot-password']);
  }
}
