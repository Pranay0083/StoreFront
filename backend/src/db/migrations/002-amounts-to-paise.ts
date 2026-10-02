import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

const TO_PAISE = 100;
const isNumber = { $type: 'number' } as const;

async function scaleFields(collection: mongo.Collection, fields: string[], extraFilter: mongo.Filter<mongo.Document> = {}) {
  for (const field of fields) {
    await collection.updateMany({ ...extraFilter, [field]: isNumber }, { $mul: { [field]: TO_PAISE } });
  }
}

async function scaleArrayField(collection: mongo.Collection, arrayField: string, field: string) {
  await collection.updateMany(
    { [`${arrayField}.${field}`]: isNumber },
    { $mul: { [`${arrayField}.$[el].${field}`]: TO_PAISE } },
    { arrayFilters: [{ [`el.${field}`]: isNumber }] },
  );
}

export const amountsToPaise: Migration = {
  id: '002-amounts-to-paise',
  description: 'Store every monetary amount as integer paise instead of rupees',
  async up(db) {
    await scaleFields(db.collection('products'), ['price', 'compareAtPrice']);
    await scaleFields(db.collection('orders'), ['subtotal', 'shipping', 'discount', 'total']);
    await scaleArrayField(db.collection('orders'), 'items', 'price');
    await scaleArrayField(db.collection('carts'), 'items', 'price');
    await scaleFields(db.collection('coupons'), ['minSubtotal', 'maxDiscount']);
    await scaleFields(db.collection('coupons'), ['value'], { type: 'flat' });
  },
};
