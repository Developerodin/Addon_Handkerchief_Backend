import express from 'express';
import passport from 'passport';
import { jwtStrategy } from '../../src/config/passport.js';
import factoryRoute from '../../src/routes/v1/factory.route.js';
import productRoute from '../../src/routes/v1/product.route.js';
import categoryRoute from '../../src/routes/v1/category.route.js';
import { errorConverter, errorHandler } from '../../src/middlewares/error.js';

const app = express();
app.use(express.json());
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);
app.use('/v1/categories', categoryRoute);
app.use('/v1/products', productRoute);
app.use('/v1', factoryRoute);
app.use(errorConverter);
app.use(errorHandler);

export default app;
