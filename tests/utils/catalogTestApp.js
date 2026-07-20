import express from 'express';
import passport from 'passport';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import cors from 'cors';
import xss from 'xss-clean';
import { jwtStrategy } from '../../src/config/passport.js';
import categoryRoute from '../../src/routes/v1/category.route.js';
import productAttributeRoute from '../../src/routes/v1/productAttribute.route.js';
import rawMaterialRoute from '../../src/routes/v1/rawMaterial.route.js';
import processRoute from '../../src/routes/v1/process.route.js';
import productRoute from '../../src/routes/v1/product.route.js';
import styleCodeRoute from '../../src/routes/v1/styleCode.route.js';
import { errorConverter, errorHandler } from '../../src/middlewares/error.js';

/**
 * Minimal Express app for catalog integration tests (no swagger/docs).
 */
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(xss());
app.use(mongoSanitize());
app.use(compression());
app.use(cors());
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);

app.use('/v1/categories', categoryRoute);
app.use('/v1/product-attributes', productAttributeRoute);
app.use('/v1/raw-materials', rawMaterialRoute);
app.use('/v1/processes', processRoute);
app.use('/v1/products', productRoute);
app.use('/v1/style-codes', styleCodeRoute);

app.use(errorConverter);
app.use(errorHandler);

export default app;
