import {Sequelize} from 'sequelize';
import {Model} from 'sequelize';
import {pickBy, keys, fromPairs, isEqual} from 'lodash';

export enum DropMode {
    ALL,
    NECESSARY
}

export interface AnglerParams {
    drop : DropMode
}


export class Angler {
    constructor(private sequelize: Sequelize, private models: Model[]) {

    }

    async dropAll() {
        return this.sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }

    async discoverTables() {
        return this.sequelize
            .query("SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE table_schema='public';", null, {raw: true})
            .spread((tables) => tables);
    }

    async discoverColumns() {
        return this.sequelize
            .query("SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema='public';", null, {raw: true})
            .spread((columns) => columns);
    }

    discoverRequiredSchema(models = this.models, schema = {}) {
        for (const model of models) {
            schema[model.tableName] = {
                columns: {}
            };
            for (const a in  model.attributes) {
                const attribute = model.attributes[a];
                schema[model.tableName].columns[a] = {
                    allowNull: attribute.allowNull,
                    type: attribute.type
                }
            }


            // console.log(model.associations);
        }

        // explore neighbour models.
        const neighbourModels = [];
        for (const model of models) {
            for (const a in model.associations) {
                const association = model.associations[a];
                const target = association.target;
                const tableName = target.tableName;
                if (!(tableName in schema)) {
                    neighbourModels.push(target)
                }
                if (association.through) {
                    const through = association.through.model;
                    const troughTableName = through.tableName;
                    if (!(troughTableName in schema)) {
                        neighbourModels.push(through);
                    }
                }
                // console.log('>>> ', through)
            }
        }
        // console.log(schema, neighbourModels);
        if (neighbourModels.length > 0) {
            this.discoverRequiredSchema(neighbourModels, schema);
        }

        return schema;
    }


    async discoverRelationalSchema() {
        const tables = await this.discoverTables();
        const columns = await this.discoverColumns();

        const schema = {};

        for (const table of tables) {
            schema[table.table_name] = {
                columns: {}
            };
        }

        for (const column of columns) {
            schema[column.table_name].columns[column.column_name] = {
                default: column.column_default
            }
        }
        return schema;
    }

    async createRequiredTables(existing, required) {
        const newTables = pickBy(required, (table, name) => !(name in existing));
        const newTableNames = keys(newTables);

        await Promise.all(newTableNames.map((name) =>
            this.sequelize.queryInterface.createTable(name, {})
        ));

        existing = {
            ...existing,
            ...fromPairs(newTableNames.map(
                (name) => [name, {
                    columns: []
                }]
            ))
        };
        const columnUpdates = [];
        for (const tableName in required) {
            const requiredTable = required[tableName];
            const existingTable = existing[tableName];
            // console.log(requiredTable, existingTable);
            for (const columnName in requiredTable.columns) {
                const requiredColumn = requiredTable.columns[columnName];
                const existingColumn = existingTable.columns[columnName];
                if (!existingColumn) {
                    columnUpdates.push(
                        this.sequelize.queryInterface.addColumn(tableName, columnName, requiredColumn)
                    )
                } else if (!isEqual(existingColumn, requiredColumn)) {
                    // console.log(existingColumn, requiredColumn);
                    columnUpdates.push(
                        this.sequelize.queryInterface.removeColumn(tableName, columnName)
                            .then(() => {
                                return this.sequelize.queryInterface.addColumn(tableName, columnName, requiredColumn)
                            })
                    )
                }
            }
        }
        await Promise.all(columnUpdates);
    }


    async sync(params: AnglerParams) {
        if (params.drop == DropMode.ALL) {
            await this.dropAll();
        }
        const existing = await this.discoverRelationalSchema();
        const required = this.discoverRequiredSchema();
        await this.createRequiredTables(existing, required);
    }
}