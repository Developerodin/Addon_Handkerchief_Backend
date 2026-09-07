import express from 'express';
import authRoute from './auth.route.js';
import userRoute from './user.route.js';
import docsRoute from './docs.route.js';
import productAttributeRoute from './productAttribute.route.js';
import rawMaterialRoute from './rawMaterial.route.js';
import categoryRoute from './category.route.js';
import processRoute from './process.route.js';
import productRoute from './product.route.js';
import styleCodeRoute from './styleCode.route.js';
import styleCodeComboRoute from './styleCodeCombo.route.js';
import fabricSupplierRoute from './fabricSupplier.route.js';
import fabricCatalogRoute from './fabricCatalog.route.js';
import fabricTypeRoute from './fabricType.route.js';
import fabricColorRoute from './fabricColor.route.js';
import fabricQualityRoute from './fabricQuality.route.js';
import fabricYarnCountRoute from './fabricYarnCount.route.js';
import fabricYarnRoute from './fabricYarn.route.js';
import fabricCountRoute from './fabricCount.route.js';
import fabricMeasurementRoute from './fabricMeasurement.route.js';
import phase3CatalogRoute from './phase3Catalog.route.js';
import commonRoute from './common.route.js';
import helpSupportRoute from './helpSupport/index.js';
import config from '../../config/config.js';

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
  {
    path: '/product-attributes',
    route: productAttributeRoute,
  },
  {
    path: '/raw-materials',
    route: rawMaterialRoute,
  },
  {
    path: '/categories',
    route: categoryRoute,
  },
  {
    path: '/processes',
    route: processRoute,
  },
  {
    path: '/products',
    route: productRoute,
  },
  {
    path: '/style-codes',
    route: styleCodeRoute,
  },
  {
    path: '/style-code-combos',
    route: styleCodeComboRoute,
  },
  {
    path: '/fabric-suppliers',
    route: fabricSupplierRoute,
  },
  {
    path: '/fabric-catalogs',
    route: fabricCatalogRoute,
  },
  {
    path: '/fabric-types',
    route: fabricTypeRoute,
  },
  {
    path: '/fabric-colors',
    route: fabricColorRoute,
  },
  {
    path: '/fabric-qualities',
    route: fabricQualityRoute,
  },
  {
    path: '/fabric-yarn-counts',
    route: fabricYarnCountRoute,
  },
  {
    path: '/fabric-yarns',
    route: fabricYarnRoute,
  },
  {
    path: '/fabric-counts',
    route: fabricCountRoute,
  },
  {
    path: '/fabric-measurements',
    route: fabricMeasurementRoute,
  },
  {
    path: '/',
    route: phase3CatalogRoute,
  },
  {
    path: '/common',
    route: commonRoute,
  },
  {
    path: '/help-support',
    route: helpSupportRoute,
  },
];

const devRoutes = [
  {
    path: '/docs',
    route: docsRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === 'development') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

export default router;
