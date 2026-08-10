export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyDanbT4KRkBnfIud-IxBnXkC1WL9VBedu8',
    authDomain: 'glaron-ade19.firebaseapp.com',
    projectId: 'glaron-ade19',
    storageBucket: 'glaron-ade19.appspot.com',
    messagingSenderId: '125813476051',
    appId: '1:125813476051:web:582306ec207d535619e226'
  },
  // Web Push (VAPID) public key — generate it in the Firebase console:
  // Project settings → Cloud Messaging → Web configuration → Web Push
  // certificates → "Generate key pair", then paste the key pair value here.
  // FCM push tokens cannot be issued until this is set.
  fcmVapidKey: 'BJpmDs0seRBQgG7i4w0MjNr7UU9Smi_92cv6uERMlzJFqvUcouOeaWpLXhSg33py0mfASc06yKZWVRrH-nOhuN8'
};
