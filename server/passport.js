const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const ALLOWED_EMAILS = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_DOMAINS = (process.env.ALLOWED_ADMIN_DOMAIN || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

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
      if (ALLOWED_DOMAINS.length > 0) {
        const allowed = ALLOWED_DOMAINS.some((d) => email.endsWith('@' + d));
        if (!allowed) {
          console.error('Google login: domain not allowed', email, 'expected one of', ALLOWED_DOMAINS.map((d) => '@' + d));
          return done(null, false, { message: 'Domain not allowed' });
        }
      }
      return done(null, { ...profile, email });
    }
  )
);

module.exports = passport;
