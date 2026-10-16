import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts',{id:text('id').primaryKey(),email:text('email').notNull(),hash:text('hash').notNull(),salt:text('salt').notNull()});
export const sessions = sqliteTable('sessions',{id:text('id').primaryKey(),owner:text('owner').notNull(),expires:integer('expires').notNull()});
export const records = sqliteTable('records',{id:text('id').primaryKey(),owner:text('owner').notNull(),kind:text('kind').notNull(),body:text('body').notNull(),updated:integer('updated').notNull()});
export const attempts = sqliteTable('attempts',{id:text('id').primaryKey(),count:integer('count').notNull(),until:integer('until').notNull()});
