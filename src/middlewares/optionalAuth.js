import passport from 'passport';

/**
 * Optionally authenticate JWT — populates req.user when token is valid.
 */
const optionalAuth = () => (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (_err, user) => {
    if (user) {
      req.user = user;
    }
    next();
  })(req, res, next);
};

export default optionalAuth;
