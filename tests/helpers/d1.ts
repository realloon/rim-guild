import { Database, type SQLQueryBindings } from 'bun:sqlite'

export class SQLitePreparedStatement {
  private parameters: SQLQueryBindings[] = []

  constructor(
    private readonly database: Database,
    private readonly sql: string,
  ) {}

  bind(...parameters: SQLQueryBindings[]) {
    this.parameters = parameters
    return this
  }

  async first<T>() {
    return this.database
      .query<T, SQLQueryBindings[]>(this.sql)
      .get(...this.parameters)
  }

  async all<T>() {
    return {
      results: this.database
        .query<T, SQLQueryBindings[]>(this.sql)
        .all(...this.parameters),
    }
  }

  async run() {
    const result = this.database.query(this.sql).run(...this.parameters)
    return {
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
      },
    }
  }
}

export class SQLiteD1 {
  constructor(private readonly database: Database) {}

  prepare(sql: string) {
    return new SQLitePreparedStatement(this.database, sql)
  }

  async batch(statements: SQLitePreparedStatement[]) {
    this.database.run('BEGIN')
    try {
      const results = []
      for (const statement of statements) {
        results.push(await statement.run())
      }
      this.database.run('COMMIT')
      return results
    } catch (error) {
      this.database.run('ROLLBACK')
      throw error
    }
  }
}

export async function loadSchema() {
  return Bun.file(new URL('../../db/schema.sql', import.meta.url)).text()
}

export function createDatabase(schema: string) {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys = ON')
  database.run(schema)
  return database
}

export function createD1(database: Database) {
  return new SQLiteD1(database) as unknown as D1Database
}
