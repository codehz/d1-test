import { generateSchema, QLiteConfig } from "@qlite/core";
import { GraphQLError } from "graphql";
import { createYoga, renderGraphiQL } from "graphql-yoga";
import type Env from "./env";
import schema_source from "./simple.yaml";
import { parse } from "yaml";

const config = QLiteConfig.parse(parse(schema_source));
const schema = generateSchema<Env>(config, {
  async all(ctx, sql, parameters) {
    try {
      const stmt = ctx.DB.prepare(sql).bind(...parameters);
      const res = await stmt.all<any>();
      if (res.error) throw new GraphQLError(res.error);
      return res.results ?? [];
    } catch (e) {
      throw new GraphQLError(e + "");
    }
  },
  async one(ctx, sql, parameters) {
    try {
      const stmt = ctx.DB.prepare(sql).bind(...parameters);
      return await stmt.first();
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
        returning: results ?? [],
      };
    } catch (e) {
      console.error(e);
      throw new GraphQLError(e + "");
    }
  },
  async mutate_batch(ctx, tasks) {
    const changes = ctx.DB.prepare("select changes() as affected_rows");
    try {
      const mapped = tasks.flatMap((task) => [
        ctx.DB.prepare(task.sql).bind(...task.parameters),
        changes,
      ]);
      const res = await ctx.DB.batch<any>(mapped);
      return tasks.map(() => {
        const { results } = res.shift() ?? {};
        const { results: [{ affected_rows = 0 } = {}] = [] } =
          res.shift() ?? {};
        return {
          affected_rows,
          returning: results ?? [],
        };
      });
    } catch (e) {
      console.error(e);
      throw new GraphQLError(e + "");
    }
  },
});

export const yoga = createYoga<Env>({
  schema,
  renderGraphiQL: renderGraphiQL as any,
});
