import express from 'express';
import passport from 'passport';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import cors from 'cors';
import xss from 'xss-clean';
import { jwtStrategy } from '../../src/config/passport.js';
import versioningRoute from '../../src/routes/v1/versioning.route.js';
import { errorConverter, errorHandler } from '../../src/middlewares/error.js';

/**
 * Express app for versioning tests. Skips swagger, which Jest cannot parse.
 */
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(xss());
app.use(mongoSanitize());
app.use(compression());
app.use(cors());
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);
app.use('/v1/versioning', versioningRoute);
app.use(errorConverter);
app.use(errorHandler);

export default app;
