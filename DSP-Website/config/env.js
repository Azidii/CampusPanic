import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve from this module so commands work from either repository directory.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
