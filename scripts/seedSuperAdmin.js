import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { getDefaultNavigationByRole } from '../src/utils/navigationHelper.js';

dotenv.config();

const SUPER_ADMIN = {
  name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
  email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@addon.in',
  password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin1',
  role: 'super_admin',
};

const seedSuperAdmin = async () => {
  const url = process.env.MONGODB_URL;
  if (!url) {
    console.error('MONGODB_URL is required');
    process.exit(1);
  }

  await mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const navigation = getDefaultNavigationByRole('super_admin');

  const existing = await User.findOne({ email: SUPER_ADMIN.email });
  if (existing) {
    existing.role = 'super_admin';
    existing.name = SUPER_ADMIN.name;
    existing.navigation = navigation;
    if (process.env.RESET_SUPER_ADMIN_PASSWORD === 'true') {
      existing.password = SUPER_ADMIN.password;
    }
    await existing.save();
    console.log(`Updated super admin: ${SUPER_ADMIN.email}`);
  } else {
    await User.create({ ...SUPER_ADMIN, navigation });
    console.log(`Created super admin: ${SUPER_ADMIN.email}`);
  }

  console.log('Default password (change after first login):', SUPER_ADMIN.password);
  await mongoose.disconnect();
};

seedSuperAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
