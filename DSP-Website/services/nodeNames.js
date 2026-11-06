import { Node } from '../models/Node.js';

export async function inspectNodeNames() {
  const nodes = await Node.find().select('nodeId name').lean(), names = new Map(), missing = [], duplicates = [];
  for (const node of nodes) {
    const key = typeof node.name === 'string' ? node.name.trim().toLowerCase() : '';
    if (!key) { missing.push(node.nodeId); continue; }
    if (names.has(key)) duplicates.push([names.get(key), node.nodeId]);
    else names.set(key, node.nodeId);
  }
  return { nodes, missing, duplicates };
}
export async function installNodeNameIndex() {
  const { nodes, missing, duplicates } = await inspectNodeNames();
  if (missing.length || duplicates.length) throw new Error('Node names require review before installing the uniqueness constraint. Run the data inventory; no nodes were renamed.');
  if (nodes.length) await Node.collection.bulkWrite(nodes.map(node => ({ updateOne: {
    filter: { _id: node._id, name: node.name }, update: { $set: { nameKey: node.name.trim().toLowerCase() } }
  } })));
  await Node.collection.createIndex({ nameKey: 1 }, { unique: true, name: 'unique_node_name' });
  const index = (await Node.collection.indexes()).find(index => index.name === 'unique_node_name');
  if (!index?.unique) throw new Error('Node name uniqueness constraint was not installed.');
}
