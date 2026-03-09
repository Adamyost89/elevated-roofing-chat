const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const ALLOWED_EMAILS = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_DOMAIN = (process.env.ALLOWED_ADMIN_DOMAIN || '').trim().toLowerCase();

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      const email = (profile?.emails?.[0]?.value || profile?._json?.email || '').toLowerCase();
      if (!email) {
        console.error('Google login: no email in profile');
        return done(null, false, { message: 'No email in profile' });
      }
      if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
        console.error('Google login: email not allowed', email);
        return done(null, false, { message: 'Email not allowed' });
      }
      if (ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) {
        console.error('Google login: domain not allowed', email, 'expected @' + ALLOWED_DOMAIN);
        return done(null, false, { message: 'Domain not allowed' });
      }
      return done(null, { ...profile, email });
    }
  )
);

module.exports = passport;
