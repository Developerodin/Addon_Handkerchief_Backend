import mongoose from 'mongoose';
import dotenv from 'dotenv';
import FabricType from '../src/models/fabricType.model.js';
import FabricColor from '../src/models/fabricColor.model.js';
import FabricQuality from '../src/models/fabricQuality.model.js';
import FabricYarnCount from '../src/models/fabricYarnCount.model.js';
import FabricMeasurement from '../src/models/fabricMeasurement.model.js';
import FabricCatalog from '../src/models/fabricCatalog.model.js';
import { ensureFabricMeasurementsSeeded } from '../src/utils/fabricMeasurementSeed.js';
import { createFabricCatalog } from '../src/services/fabricCatalog.service.js';

dotenv.config();

const SAMPLE_TAG = 'HK-FABRIC-SAMPLE';

const TYPE_NAMES = ['Voile', 'Poplin', 'Cambric'];
const COLOR_ROWS = [
  { name: 'White', colorCode: '#FFFFFF' },
  { name: 'Navy', colorCode: '#001F3F' },
  { name: 'Red', colorCode: '#CC0000' },
];
const QUALITY_NAMES = ['Premium Cotton', 'Standard Cotton'];
const YARN_COUNT_NAMES = ["60's Compact", "40's Ring Spun"];

const upsertByName = async (Model, rows, mapRow = (row) => row) => {
  const map = {};
  for (const row of rows) {
    const payload = mapRow(row);
    let doc = await Model.findOne({ name: payload.name });
    if (!doc) {
      doc = await Model.create({ ...payload, status: 'active' });
    }
    map[payload.name] = doc;
  }
  return map;
};

const seedFabricMasters = async () => {
  const url = process.env.MONGODB_URL;
  if (!url) {
    console.error('MONGODB_URL is required');
    process.exit(1);
  }

  await mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const existing = await FabricCatalog.findOne({ remark: SAMPLE_TAG });
  if (existing && process.env.FORCE_FABRIC_SEED !== 'true') {
    console.log('Fabric sample data already exists. Set FORCE_FABRIC_SEED=true to re-seed.');
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    await FabricCatalog.deleteMany({ remark: SAMPLE_TAG });
  }

  await ensureFabricMeasurementsSeeded();

  const types = await upsertByName(
    FabricType,
    TYPE_NAMES.map((name) => ({ name }))
  );
  const colors = await upsertByName(FabricColor, COLOR_ROWS, (row) => ({
    name: row.name,
    colorCode: row.colorCode,
    pantone: '',
  }));
  const qualities = await upsertByName(
    FabricQuality,
    QUALITY_NAMES.map((name) => ({ name, remarks: SAMPLE_TAG }))
  );
  const yarnCounts = await upsertByName(
    FabricYarnCount,
    YARN_COUNT_NAMES.map((name) => ({ name }))
  );

  const gsm = await FabricMeasurement.findOne({ name: 'GSM', category: 'weight' });
  const inch = await FabricMeasurement.findOne({ name: 'Inch', category: 'length' });
  if (!gsm || !inch) {
    throw new Error('GSM and Inch measurements are required after seed');
  }

  const catalogRows = [
    {
      name: 'White Cotton Voile',
      fabricSortNo: 'FC-VOILE-01',
      fabricType: types.Voile._id,
      color: colors.White._id,
      quality: qualities['Premium Cotton']._id,
      yarnCount: yarnCounts["60's Compact"]._id,
      construction: '92x80',
      weave: 'Plain',
      design: 'Plain',
      wash: 'Yes',
      finish: 'NA',
      glm: 60,
      glmMeasurement: gsm._id,
      finishedWidth: 44,
      finishedWidthMeasurement: inch._id,
      rate: 85,
      gst: '5',
      hsnCode: '52082100',
      minQuantity: 50,
      status: 'active',
      remark: SAMPLE_TAG,
    },
    {
      name: 'Navy Poplin Print',
      fabricSortNo: 'FC-POP-02',
      fabricType: types.Poplin._id,
      color: colors.Navy._id,
      quality: qualities['Standard Cotton']._id,
      yarnCount: yarnCounts["40's Ring Spun"]._id,
      construction: '110x76',
      weave: 'Poplin',
      design: 'Print',
      wash: 'No',
      finish: 'N9',
      glm: 72,
      glmMeasurement: gsm._id,
      finishedWidth: 58,
      finishedWidthMeasurement: inch._id,
      rate: 95,
      gst: '5',
      hsnCode: '52082100',
      minQuantity: 40,
      status: 'active',
      remark: SAMPLE_TAG,
    },
    {
      name: 'Cambric Silver Finish',
      fabricSortNo: 'FC-CAM-03',
      fabricType: types.Cambric._id,
      color: colors.Red._id,
      quality: qualities['Premium Cotton']._id,
      yarnCount: yarnCounts["60's Compact"]._id,
      construction: '80x80',
      weave: 'Plain',
      design: 'Plain',
      wash: 'Yes',
      finish: 'Silverdor',
      glm: 55,
      glmMeasurement: gsm._id,
      finishedWidth: 42,
      finishedWidthMeasurement: inch._id,
      rate: 78,
      gst: '5',
      hsnCode: '52082100',
      minQuantity: 35,
      status: 'active',
      remark: SAMPLE_TAG,
    },
  ];

  for (const row of catalogRows) {
    const found = await FabricCatalog.findOne({ fabricSortNo: row.fabricSortNo });
    if (found) {
      await FabricCatalog.deleteOne({ _id: found._id });
    }
    await createFabricCatalog(row);
  }

  console.log('Fabric masters seeded:');
  console.log(`  Fabric Types: ${TYPE_NAMES.length}`);
  console.log(`  Fabric Colors: ${COLOR_ROWS.length}`);
  console.log(`  Fabric Qualities: ${QUALITY_NAMES.length}`);
  console.log(`  Fabric Yarn/Counts: ${YARN_COUNT_NAMES.length}`);
  console.log(`  Fabric Measurements: GSM + Inch (auto-seeded if empty)`);
  console.log(`  Fabric Catalog: ${catalogRows.length}`);
  console.log(`Tag in DB: remark="${SAMPLE_TAG}"`);

  await mongoose.disconnect();
};

seedFabricMasters().catch((err) => {
  console.error(err);
  process.exit(1);
});
