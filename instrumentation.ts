import { getDatabaseWithMigrationWait } from './src/lib/server/database';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[instrumentation] Starting application initialization...');
    
    // Initialize database and wait for migration completion
    await getDatabaseWithMigrationWait();
    
    console.log('[instrumentation] Application initialization complete');
  }
}