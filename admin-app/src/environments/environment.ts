export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyDanbT4KRkBnfIud-IxBnXkC1WL9VBedu8',
    authDomain: 'glaron-ade19.firebaseapp.com',
    projectId: 'glaron-ade19',
    storageBucket: 'glaron-ade19.appspot.com',
    messagingSenderId: '125813476051',
    appId: '1:125813476051:web:582306ec207d535619e226'
  },
  // Web Push (VAPID) public key — Firebase console → Project settings →
  // Cloud Messaging → Web configuration → Web Push certificates.
  // The same key pair serves both PWAs; push tokens cannot be issued without it.
  fcmVapidKey: 'BJpmDs0seRBQgG7i4w0MjNr7UU9Smi_92cv6uERMlzJFqvUcouOeaWpLXhSg33py0mfASc06yKZWVRrH-nOhuN8'
};
