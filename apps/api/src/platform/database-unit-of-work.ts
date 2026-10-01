import type { Database } from "@sct/database";
import type { Transaction, UnitOfWork } from "../auth/application/ports";

export class DatabaseUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx));
  }
}
