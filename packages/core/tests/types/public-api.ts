import {
  SheetDB,
  SheetGateway,
  SheetQuery,
  SheetRelation,
  SheetTable,
} from "../../src";
import type {
  CurrentRecord,
  NestedCreateInput,
  OnDeleteAction,
  SheetJoin,
  SheetQueryResult,
} from "../../src";

void SheetDB;
void SheetGateway;
void SheetQuery;
void SheetRelation;
void SheetTable;

type PublicTypes =
  | CurrentRecord<any, any>
  | NestedCreateInput<any, any>
  | OnDeleteAction
  | SheetJoin<any>
  | SheetQueryResult<any>;

const publicType: PublicTypes | null = null;
void publicType;

// @ts-expect-error internal implementation is not part of the package root API
import { CommandBuffer } from "../../src";
// @ts-expect-error gateway abstraction is internal; consumers use SheetGateway
import { AccessableDataStore } from "../../src";
