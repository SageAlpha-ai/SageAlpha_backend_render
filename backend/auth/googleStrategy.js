const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../../models/User');

/**
 * Google OAuth Strategy Configuration
 * 
 * This strategy handles Google OAuth authentication:
 * - Finds existing user by googleId
 * - Creates new user if not found
 * - Does NOT use sessions (JWT-based auth only)
 */
const configureGoogleStrategy = () => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const BACKEND_URL = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:8000';

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[GOOGLE OAUTH] Google OAuth credentials not configured. Google login will be disabled.');
    return;
  }

  // Remove trailing slash from backend URL
  const baseUrl = BACKEND_URL.replace(/\/$/, '');
  const callbackURL = `${baseUrl}/auth/google/callback`;

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Find user by googleId
          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            // User exists - update profile info if needed
            if (profile.photos && profile.photos[0] && profile.photos[0].value !== user.avatar) {
              user.avatar = profile.photos[0].value;
              await user.save();
            }
            return done(null, user);
          }

          // Check if user exists with same email (merge accounts)
          user = await User.findOne({ email: profile.emails[0].value });
          if (user) {
            // Link Google account to existing user
            user.googleId = profile.id;
            user.authProvider = 'google';
            if (profile.photos && profile.photos[0]) {
              user.avatar = profile.photos[0].value;
            }
            // Make password optional for Google users
            if (!user.password_hash) {
              user.password_hash = null; // Allow null for Google users
            }
            await user.save();
            return done(null, user);
          }

          // Create new user
          const newUser = new User({
            email: profile.emails[0].value,
            display_name: profile.displayName || profile.name?.givenName || profile.emails[0].value.split('@')[0],
            username: profile.emails[0].value, // Use email as username for Google users
            googleId: profile.id,
            avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
            authProvider: 'google',
            password_hash: null, // No password for Google users
            is_active: true,
          });

          await newUser.save();
          return done(null, newUser);
        } catch (error) {
          console.error('[GOOGLE OAUTH] Error in strategy callback:', error);
          return done(error, null);
        }
      }
    )
  );

  console.log('[GOOGLE OAUTH] Strategy configured successfully');
};

module.exports = configureGoogleStrategy;

