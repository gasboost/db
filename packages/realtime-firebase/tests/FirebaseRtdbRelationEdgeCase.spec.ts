import {
  and,
  column,
  eq,
  exists,
  literal,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FirebaseRtdb, type FirebaseRtdbRelationResolver } from "../src";

const principalSchema = z.object({
  employeeId: z.string(),
});

const requestSchema = z.object({
  id: z.string(),
  applicantId: z.string(),
  status: z.string(),
});

const destinationSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  destination: z.string(),
});

const requests = {
  name: "requests",
  schema: requestSchema,
  primaryKey: "id",
} as const;

const destinations = {
  name: "destinations",
  schema: destinationSchema,
  primaryKey: "id",
} as const;

function requestSecurity() {
  return new RowLevelSecurity({
    table: requests,
    select: {
      using: eq(
        column(requests, "applicantId"),
        principal(principalSchema, "employeeId"),
      ),
    },
  });
}

function relationOwner() {
  return exists(
    requests,
    and(
      eq(column(requests, "id"), outerColumn(destinations, "requestId")),
      eq(
        column(requests, "applicantId"),
        principal(principalSchema, "employeeId"),
      ),
    ),
  );
}

function generate() {
  return FirebaseRtdb.generate({
    tables: [requests, destinations] as const,
    rowLevelSecurity: [
      requestSecurity(),
      new RowLevelSecurity({
        table: destinations,
        select: {
          using: relationOwner(),
        },
      }),
    ],
    principal: {
      employeeId: "auth.token.employeeId",
    },
  });
}

describe("FirebaseRtdb relation-aware RLS edge cases", () => {
  it("parent primary key以外をrelation target keyとして利用することを拒否する", () => {
    const security = new RowLevelSecurity({
      table: destinations,
      select: {
        using: exists(
          requests,
          and(
            eq(
              column(requests, "status"),
              outerColumn(destinations, "requestId"),
            ),
            eq(
              column(requests, "applicantId"),
              principal(principalSchema, "employeeId"),
            ),
          ),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [requests, destinations] as const,
        rowLevelSecurity: [requestSecurity(), security],
        principal: {
          employeeId: "auth.token.employeeId",
        },
      }),
    ).toThrow(
      "RTDB relation projection requires the referenced key to be primary key 'id'",
    );
  });

  it("resolverが要求されたprimary keyと異なるparent recordを返した場合は拒否する", () => {
    const rtdb = generate();

    expect(() =>
      rtdb.destinations.record(
        {
          id: "destination-1",
          requestId: "request-1",
          destination: "Tokyo",
        },
        {
          resolve: () => ({
            id: "request-999",
            applicantId: "employee-1",
            status: "draft",
          }),
        },
      ),
    ).toThrow(
      "Resolved relation record 'requests' does not match 'id=request-1'.",
    );
  });

  it("async relation resolverを明示的に拒否する", () => {
    const rtdb = generate();

    const resolve = (async () => ({
      id: "request-1",
      applicantId: "employee-1",
      status: "draft",
    })) as unknown as FirebaseRtdbRelationResolver;

    expect(() =>
      rtdb.destinations.record(
        {
          id: "destination-1",
          requestId: "request-1",
          destination: "Tokyo",
        },
        {
          resolve,
        },
      ),
    ).toThrow(
      "FirebaseRtdbTable.record() requires a synchronous relation resolver.",
    );
  });

  it("relation partitionのsourceにliteralを利用できる", () => {
    const security = new RowLevelSecurity({
      table: destinations,
      select: {
        using: exists(
          requests,
          and(
            eq(column(requests, "id"), outerColumn(destinations, "requestId")),
            eq(column(requests, "status"), literal("draft")),
          ),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [requests, destinations] as const,
      rowLevelSecurity: [security],
      principal: {},
    });

    expect(
      rtdb.destinations.record(
        {
          id: "destination-1",
          requestId: "request-1",
          destination: "Tokyo",
        },
        {
          resolve: ({ table, primaryKey, value }) => {
            expect(table).toBe(requests);
            expect(primaryKey).toBe("id");
            expect(value).toBe("request-1");

            return {
              id: "request-1",
              applicantId: "employee-1",
              status: "draft",
            };
          },
        },
      ),
    ).toBe("/destinations/__rls/status/draft/destination-1");

    expect(rtdb.destinations.scope({})).toBe(
      "/destinations/__rls/status/draft",
    );

    const recordRules = (rtdb.rules().rules.destinations as any).__rls.status
      .draft.$recordId;

    expect(recordRules[".validate"]).toContain(
      'root.child("requests").child((newData.child("requestId").val() + \'\'))',
    );

    expect(recordRules[".validate"]).toContain(
      'child("status").val() === "draft"',
    );
  });

  it("outerColumnがcurrent table以外を参照する場合は拒否する", () => {
    const otherDestinations = {
      ...destinations,
      name: "otherDestinations",
    } as const;

    const security = new RowLevelSecurity({
      table: destinations,
      select: {
        using: exists(
          requests,
          and(
            eq(
              column(requests, "id"),
              outerColumn(otherDestinations, "requestId"),
            ),
            eq(
              column(requests, "applicantId"),
              principal(principalSchema, "employeeId"),
            ),
          ),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [requests, destinations] as const,
        rowLevelSecurity: [requestSecurity(), security],
        principal: {
          employeeId: "auth.token.employeeId",
        },
      }),
    ).toThrow("but the current RTDB table is 'destinations'");
  });

  it("relation-aware updateはusingをcurrent、checkをnext snapshotから評価する", () => {
    const owner = relationOwner();

    const security = new RowLevelSecurity({
      table: destinations,

      select: {
        using: owner,
      },

      update: {
        using: owner,
        check: owner,
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [requests, destinations] as const,
      rowLevelSecurity: [requestSecurity(), security],
      principal: {
        employeeId: "auth.token.employeeId",
      },
    });

    const recordRules = (rtdb.rules().rules.destinations as any).__rls
      .applicantId.$scope0.$recordId;

    const write = recordRules[".write"] as string;

    expect(write).toContain('data.child("requestId").val()');

    expect(write).toContain('newData.child("requestId").val()');

    expect(write).toContain(
      'root.child("requests").child("__rls").child("applicantId").child($scope0)',
    );
  });

  it("multi-hop relation projectionをfail closedで拒否する", () => {
    const organizations = {
      name: "organizations",
      schema: z.object({
        id: z.string(),
        ownerId: z.string(),
      }),
      primaryKey: "id",
    } as const;

    const tripRequests = {
      name: "tripRequests",
      schema: z.object({
        id: z.string(),
        organizationId: z.string(),
        status: z.string(),
      }),
      primaryKey: "id",
    } as const;

    const tripDestinations = {
      name: "tripDestinations",
      schema: z.object({
        id: z.string(),
        requestId: z.string(),
      }),
      primaryKey: "id",
    } as const;

    const tripRequestSecurity = new RowLevelSecurity({
      table: tripRequests,
      select: {
        using: exists(
          organizations,
          and(
            eq(
              column(organizations, "id"),
              outerColumn(tripRequests, "organizationId"),
            ),
            eq(
              column(organizations, "ownerId"),
              principal(principalSchema, "employeeId"),
            ),
          ),
        ),
      },
    });

    const tripDestinationSecurity = new RowLevelSecurity({
      table: tripDestinations,
      select: {
        using: exists(
          tripRequests,
          and(
            eq(
              column(tripRequests, "id"),
              outerColumn(tripDestinations, "requestId"),
            ),
            eq(column(tripRequests, "status"), literal("draft")),
          ),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [organizations, tripRequests, tripDestinations] as const,
        rowLevelSecurity: [tripRequestSecurity, tripDestinationSecurity],
        principal: {
          employeeId: "auth.token.employeeId",
        },
      }),
    ).toThrow(
      "would require multi-hop relation projection, which is not currently supported.",
    );
  });
});
