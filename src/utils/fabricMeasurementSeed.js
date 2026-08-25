import FabricMeasurement from '../models/fabricMeasurement.model.js';

export const DEFAULT_FABRIC_MEASUREMENTS = [
  { name: 'Inch', symbol: 'in', category: 'length' },
  { name: 'Centimeter', symbol: 'cm', category: 'length' },
  { name: 'Millimeter', symbol: 'mm', category: 'length' },
  { name: 'Meter', symbol: 'm', category: 'length' },
  { name: 'Yard', symbol: 'yd', category: 'length' },
  { name: 'Foot', symbol: 'ft', category: 'length' },
  { name: 'GLM', symbol: 'glm', category: 'weight' },
  { name: 'GSM', symbol: 'gsm', category: 'weight' },
  { name: 'Gram', symbol: 'g', category: 'weight' },
  { name: 'Kilogram', symbol: 'kg', category: 'weight' },
  { name: 'Ounce', symbol: 'oz', category: 'weight' },
  { name: 'Pound', symbol: 'lb', category: 'weight' },
  { name: 'Oz/yd²', symbol: 'oz/yd²', category: 'weight' },
  { name: 'Piece', symbol: 'pc', category: 'quantity' },
  { name: 'Pair', symbol: 'pr', category: 'quantity' },
  { name: 'Dozen', symbol: 'dz', category: 'quantity' },
  { name: 'Gross', symbol: 'gr', category: 'quantity' },
  { name: 'Roll', symbol: 'roll', category: 'quantity' },
  { name: 'Bale', symbol: 'bale', category: 'quantity' },
  { name: 'Bundle', symbol: 'bdl', category: 'quantity' },
  { name: 'Square meter', symbol: 'm²', category: 'area' },
  { name: 'Square yard', symbol: 'yd²', category: 'area' },
  { name: 'Square foot', symbol: 'ft²', category: 'area' },
];

export const ensureFabricMeasurementsSeeded = async () => {
  const count = await FabricMeasurement.countDocuments();
  if (count > 0) return;
  await FabricMeasurement.insertMany(
    DEFAULT_FABRIC_MEASUREMENTS.map((row) => ({
      ...row,
      status: 'active',
    }))
  );
};
