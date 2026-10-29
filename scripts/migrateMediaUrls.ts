import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI not set');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const coll = mongoose.connection.db!.collection('mediaassets');
  const docs = await coll.find({}).toArray();
  let updated = 0;
  for (const doc of docs) {
    if (doc.storageKey && (!doc.url || !doc.url.startsWith('/storage/'))) {
      const correctUrl = `/storage/${doc.storageKey}`;
      await coll.updateOne({ _id: doc._id }, { $set: { url: correctUrl } });
      console.log(`Updated ${doc.filename}: ${doc.url} -> ${correctUrl}`);
      updated++;
    }
  }
  console.log(`Migration complete. Updated ${updated} document(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
