import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { DealerApprovalService } from '../dealer-approval.service';
import { DealerAuthService } from '../dealer-auth.service';
import { NotificationService } from '../admin/notification.service';
import { INDIA_STATES_CITIES } from './india-locations';

@Component({
  selector: 'app-dealer-apply',
  templateUrl: './dealer-apply.page.html',
  styleUrls: ['./dealer-apply.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class DealerApplyPage implements OnInit {
  applyForm!: FormGroup;
  isLoading = false;
  isSubmitted = false;
  errorMessage = '';
  showPassword = false;
  showConfirmPassword = false;
  // The mobile number the dealer just registered with — shown on the success
  // screen and used as their sign-in identity.
  registeredMobile = '';

  // ----- Multi-step wizard state -----
  // The existing single reactive form is unchanged; the wizard just gates which
  // fields are visible per step and validates that slice before advancing.
  currentStep = 0;
  readonly steps: { title: string; subtitle: string; fields: string[] }[] = [
    { title: 'Your details', subtitle: 'Tell us who you are', fields: ['contactPerson', 'mobile', 'email'] },
    { title: 'Business address', subtitle: 'Where you operate from', fields: ['address', 'state', 'city', 'pincode'] },
    { title: 'Secure account', subtitle: 'Create your password', fields: ['password', 'confirmPassword'] },
  ];

  // ----- State / City / Pincode cascading dropdowns -----
  private readonly statesData = INDIA_STATES_CITIES;

  // Which dropdown is currently open: 'state' | 'city' | 'pincode' | null
  openDropdown: 'state' | 'city' | 'pincode' | null = null;

  // Search text typed inside each dropdown
  stateSearch = '';
  citySearch = '';

  // Options
  filteredStates: string[] = [];
  filteredCities: string[] = [];
  pincodeSuggestions: string[] = [];
  isLoadingPincodes = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private dealerAuth: DealerAuthService,
    private approval: DealerApprovalService,
    private notifications: NotificationService
  ) {}

  ngOnInit() {
    // Set up the dealer notification listener (prompts for permission on first
    // tap) so the OS "approved" push can reach this device once approved.
    this.notifications.startDealerListener();
    // Firestore writes need an authenticated caller — start that session now so
    // submitting the form doesn't have to wait on it.
    this.dealerAuth.ensureFirebaseSession();

    this.applyForm = this.fb.group({
      contactPerson: ['', [Validators.required, Validators.minLength(2)]],
      // The mobile number is the dealer's login identity.
      mobile: ['', [Validators.required, Validators.pattern('^[6-9][0-9]{9}$')]],
      // Optional — collected for contact only, never used to sign in. Validated
      // only when something has actually been typed.
      email: ['', [Validators.email]],
      address: ['', [Validators.required]],
      state: ['', [Validators.required]],
      city: ['', [Validators.required]],
      pincode: ['', [Validators.required, Validators.pattern('^[0-9]{6}$')]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });

    this.filteredStates = this.statesData.map(s => s.state);
  }

  // ----- Dropdown open / close -----
  toggleDropdown(which: 'state' | 'city' | 'pincode', event?: Event) {
    event?.stopPropagation();
    // City can't open until a state is chosen
    if (which === 'city' && !this.applyForm.get('state')?.value) return;

    this.openDropdown = this.openDropdown === which ? null : which;

    if (this.openDropdown === 'state') {
      this.stateSearch = '';
      this.filteredStates = this.statesData.map(s => s.state);
    } else if (this.openDropdown === 'city') {
      this.citySearch = '';
      this.filteredCities = this.getCitiesForSelectedState();
    }
  }

  @HostListener('document:click')
  closeDropdowns() {
    this.openDropdown = null;
  }

  // Stop clicks inside a dropdown from bubbling to the document (which closes it)
  stopClose(event: Event) {
    event.stopPropagation();
  }

  // ----- State -----
  onStateSearch(value: string) {
    this.stateSearch = value;
    const q = value.toLowerCase().trim();
    this.filteredStates = this.statesData
      .map(s => s.state)
      .filter(s => s.toLowerCase().includes(q));
  }

  selectState(state: string) {
    this.applyForm.patchValue({ state, city: '', pincode: '' });
    this.pincodeSuggestions = [];
    this.filteredCities = this.getCitiesForSelectedState();
    this.openDropdown = null;
  }

  private getCitiesForSelectedState(): string[] {
    const state = this.applyForm.get('state')?.value;
    const match = this.statesData.find(s => s.state === state);
    return match ? match.cities : [];
  }

  // ----- City -----
  onCitySearch(value: string) {
    this.citySearch = value;
    const q = value.toLowerCase().trim();
    this.filteredCities = this.getCitiesForSelectedState()
      .filter(c => c.toLowerCase().includes(q));
  }

  selectCity(city: string) {
    this.applyForm.patchValue({ city, pincode: '' });
    this.openDropdown = null;
    this.loadPincodesForCity(city);
  }

  // ----- Pincode -----
  // Fetch pincodes for the selected city from the free India Post API.
  // The field stays fully editable — the user can clear it and type their own.
  private async loadPincodesForCity(city: string) {
    this.pincodeSuggestions = [];
    if (!city) return;
    this.isLoadingPincodes = true;
    try {
      const res = await fetch(`https://api.postalpincode.in/postoffice/${encodeURIComponent(city)}`);
      const data = await res.json();
      const record = Array.isArray(data) ? data[0] : null;
      if (record && record.Status === 'Success' && Array.isArray(record.PostOffice)) {
        const codes: string[] = record.PostOffice
          .map((po: any) => String(po.Pincode || ''))
          .filter((p: string) => p.length > 0);
        this.pincodeSuggestions = Array.from(new Set<string>(codes)).sort();
      }
    } catch (e) {
      // Offline / API failure — user can still type the pincode manually.
      console.warn('Pincode lookup notice:', e);
    } finally {
      this.isLoadingPincodes = false;
    }
  }

  openPincodeDropdown(event?: Event) {
    event?.stopPropagation();
    if (!this.pincodeSuggestions.length) return;
    this.openDropdown = this.openDropdown === 'pincode' ? null : 'pincode';
  }

  selectPincode(pincode: string) {
    this.applyForm.patchValue({ pincode });
    this.openDropdown = null;
  }

  // ----- Wizard navigation -----
  get progressPct(): number {
    return Math.round(((this.currentStep + 1) / this.steps.length) * 100);
  }

  get isLastStep(): boolean {
    return this.currentStep === this.steps.length - 1;
  }

  // Are all controls in a given step valid? The final step also requires the
  // password-match cross-validator to pass.
  isStepValid(index: number): boolean {
    const step = this.steps[index];
    if (!step) return false;
    const controlsOk = step.fields.every(f => this.applyForm.get(f)?.valid);
    if (index === this.steps.length - 1) {
      return controlsOk && !this.applyForm.hasError('mismatch');
    }
    return controlsOk;
  }

  // Advance only when the current slice validates; otherwise reveal its errors.
  nextStep() {
    if (!this.isStepValid(this.currentStep)) {
      this.steps[this.currentStep].fields.forEach(f => this.applyForm.get(f)?.markAsTouched());
      return;
    }
    this.errorMessage = '';
    if (!this.isLastStep) {
      this.currentStep++;
      this.scrollFormTop();
    }
  }

  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.openDropdown = null;
      this.scrollFormTop();
    }
  }

  private scrollFormTop() {
    try {
      document.querySelector('.reg-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}
  }

  passwordMatchValidator(g: FormGroup) {
    const pass = g.get('password')?.value;
    const confirmPass = g.get('confirmPassword')?.value;
    return pass === confirmPass ? null : { mismatch: true };
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // Keep only digits in the mobile field, so a pasted "+91 98765 43210" still
  // validates as the 10-digit number we key the account by.
  onMobileInput(value: string) {
    const digits = this.dealerAuth.normalizeMobile(value);
    if (digits !== value) {
      this.applyForm.get('mobile')?.setValue(digits, { emitEvent: false });
    }
  }

  async onSubmit() {
    if (this.applyForm.invalid) {
      this.applyForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const val = this.applyForm.value;
    const mobile = this.dealerAuth.normalizeMobile(val.mobile);

    try {
      // Create the dealer in Firestore with a hashed password keyed to their
      // mobile number. No verification message is sent anywhere — access is
      // gated by admin approval instead.
      const result = await this.dealerAuth.register({
        name: val.contactPerson,
        contactPerson: val.contactPerson,
        mobile,
        email: (val.email || '').trim(),
        address: val.address,
        state: val.state,
        city: val.city,
        pincode: val.pincode,
        location: `${val.city}, ${val.state} - ${val.pincode}`,
        password: val.password
      });

      if (result.status === 'mobile-taken') {
        this.errorMessage = 'This mobile number is already registered. Please sign in instead, or contact the Glaron team if you have forgotten your password.';
        // Send them back to the step that holds the mobile field.
        this.currentStep = 0;
        this.applyForm.get('mobile')?.markAsTouched();
        this.scrollFormTop();
        return;
      }

      if (result.status === 'error') {
        this.errorMessage = result.message;
        return;
      }

      this.registeredMobile = mobile;
      this.isSubmitted = true;
    } catch (error: any) {
      console.error('Registration error:', error);
      this.errorMessage = 'Could not complete your registration. Please check your connection and try again.';
    } finally {
      this.isLoading = false;
      // On a successful registration, remember the mobile so the login page /
      // PWA can announce the moment the admin approves this account.
      if (this.isSubmitted && this.registeredMobile) {
        this.approval.markPending(this.registeredMobile);
      }
    }
  }

  goToLogin() {
    this.router.navigate(['/dealer/login']);
  }
}
