import type { Migration } from '../migration';

export const cartLines: Migration = {
  id: '032-cart-lines',
  description: 'Strip client-supplied titles, images and prices from stored carts',
  async up(db) {
    await db
      .collection('carts')
      .updateMany(
        { 'items.0': { $exists: true } },
        { $unset: { 'items.$[].title': '', 'items.$[].image': '', 'items.$[].price': '', 'items.$[].slug': '', 'items.$[]._id': '' } },
      );
  },
};
