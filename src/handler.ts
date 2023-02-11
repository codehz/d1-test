import { makeExecutableSchema, mergeSchemas } from "@graphql-tools/schema";
import {
  BuiltinDefinitions,
  generateResolver,
  generateRootTypeDefs,
  fixupResult,
  cacheAllSQLMapperInfo,
} from "@qlite/core";
import { buildASTSchema, DocumentNode, GraphQLError, parse } from "graphql";
import { createYoga, renderGraphiQL } from "graphql-yoga";
import type Env from "./env";
import schema_source from "./simple.graphql";

const parsed = parse(schema_source);
const processed: DocumentNode = {
  ...parsed,
  definitions: [...BuiltinDefinitions.definitions, ...parsed.definitions],
};
const schema = buildASTSchema(processed);
const typedefs = generateRootTypeDefs(schema);
const merged = mergeSchemas({
  schemas: [schema],
  typeDefs: [typedefs],
});
const resolver = generateResolver<Env>(merged, {
  async all(ctx, sql, parameters) {
    try {
      const stmt = ctx.DB.prepare(sql).bind(...parameters);
      const res = await stmt.all<any>();
      if (res.error) throw new GraphQLError(res.error);
      return res.results?.map(fixupResult) ?? [];
    } catch (e) {
      throw new GraphQLError(e + "");
    }
  },
  async one(ctx, sql, parameters) {
    try {
      const stmt = ctx.DB.prepare(sql).bind(...parameters);
      return fixupResult(await stmt.first());
    } catch (e) {
      console.error(e);
      throw new GraphQLError(e + "");
    }
  },
  async mutate(ctx, sql, parameters) {
    const changes = ctx.DB.prepare("select changes() as affected_rows");
    try {
      const stmt = ctx.DB.prepare(sql).bind(...parameters);
      const [{ results }, { results: [{ affected_rows = 0 } = {}] = [] }] =
        await ctx.DB.batch<any>([stmt, changes]);
      return {
        affected_rows,
        returning: results?.map(fixupResult) ?? [],
      };
    } catch (e) {
      console.error(e);
      throw new GraphQLError(e + "");
    }
  },
  async mutate_batch(ctx, tasks) {
    const changes = ctx.DB.prepare("select changes() as affected_rows");
    try {
      const mapped = tasks.flatMap((task) =>
        task ? [ctx.DB.prepare(task.sql).bind(...task.parameters), changes] : []
      );
      const res = await ctx.DB.batch<any>(mapped);
      return tasks.map((x) => {
        if (!x)
          return {
            affected_rows: 0,
            returning: [],
          };
        const { results } = res.shift() ?? {};
        const { results: [{ affected_rows = 0 } = {}] = [] } =
          res.shift() ?? {};
        return {
          affected_rows,
          returning: results?.map(fixupResult) ?? [],
        };
      });
    } catch (e) {
      console.error(e);
      throw new GraphQLError(e + "");
    }
  },
});
const executable = makeExecutableSchema({
  typeDefs: [merged],
  resolvers: [resolver],
});

export const yoga = createYoga<Env>({
  schema: executable,
  renderGraphiQL: renderGraphiQL as any,
});
