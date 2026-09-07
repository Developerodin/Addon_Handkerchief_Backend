import moment from 'moment';
import config from '../../src/config/config.js';
import { tokenTypes } from '../../src/config/tokens.js';
import { generateToken } from '../../src/services/token.service.js';
import { userOne, admin } from './user.fixture.js';

const accessTokenExpires = moment().add(config.jwt.accessExpirationMinutes, 'minutes');
const userOneAccessToken = generateToken(userOne._id, accessTokenExpires, tokenTypes.ACCESS);
const adminAccessToken = generateToken(admin._id, accessTokenExpires, tokenTypes.ACCESS);

export { userOneAccessToken, adminAccessToken };
