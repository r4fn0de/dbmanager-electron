import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TableDataEditor } from "@/features/database/components/TableDataEditor/TableDataEditor";
import type { SchemaTable, TableRowsResponse } from "@/ipc/db/types";

vi.mock("@/features/database/hooks/db-actions", () => ({
  tableListRows: vi.fn(),
}));

vi.mock("@/features/shell/actions/window", () => ({
  setUnsavedChanges: vi.fn(),
}));

import { tableListRows } from "@/features/database/hooks/db-actions";

const mockTableListRows = vi.mocked(tableListRows);

const table: SchemaTable = {
  columns: [
    { column_default: null, data_type: "uuid", is_nullable: false, name: "id" },
    { column_default: null, data_type: "text", is_nullable: true, name: "name" },
  ],
  foreign_keys: [],
  has_rls: false,
  indexes: [{ column_names: ["id"], is_primary: true, is_unique: true, name: "pk" }],
  name: "events",
  rls_policies: [],
  schema: "public",
};

const rowsResponse: TableRowsResponse = {
  columns: [
    { name: "id", type_name: "uuid" },
    { name: "name", type_name: "text" },
  ],
  foreignKeys: [],
  pageInfo: { hasNextPage: false, page: 1, pageSize: 50 },
  primaryKey: ["id"],
  rows: [
    { id: "11111111-1111-1111-1111-111111111111", name: "alpha" },
    { id: "22222222-2222-2222-2222-222222222222", name: "beta" },
  ],
  totalEstimate: 2,
  totalIsEstimated: false,
};

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TableDataEditor
        connectionId="conn-1"
        disableWindowUnsavedTracking
        table={table}
        tableFkLookup={async () => ({ hasMore: false, options: [] })}
        tableSaveChanges={async () => ({ deleted: 0, inserted: 0, updated: 0 })}
        tableTruncate={async () => {}}
      />
    </QueryClientProvider>
  );
}

describe("table column resizing", () => {
  beforeEach(() => {
    mockTableListRows.mockResolvedValue(rowsResponse);
    // jsdom has no layout: give the scroll container a size so the row
    // virtualizer (which needs outerSize > 0) renders rows.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 800,
    });
  });

  it("updates header and body cells live during the drag and commits on release", async () => {
    const { container } = renderEditor();

    await screen.findByText("alpha");
    const handle = await screen.findByLabelText("Resize column name");
    const headerCell = handle.parentElement;
    expect(headerCell?.style.width).toBe("200px");
    const bodyCell = screen.getByText("alpha").closest("td");
    expect(bodyCell?.style.width).toBe("200px");

    // Drag +100px: widths must follow the cursor BEFORE mouse up (live).
    fireEvent.mouseDown(handle, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 300 });
    expect(headerCell?.style.width).toBe("300px");
    expect(bodyCell?.style.width).toBe("300px");

    // Release: the width stays committed (no snap-back).
    fireEvent.mouseUp(document);
    expect(headerCell?.style.width).toBe("300px");
    expect(
      container.querySelector('td[data-column="name"]') instanceof HTMLElement
    ).toBe(true);
    const committedBodyCell = screen.getByText("alpha").closest("td");
    expect(committedBodyCell?.style.width).toBe("300px");
  });

  it("shifts columns to the right live during the drag", async () => {
    renderEditor();

    await screen.findByText("alpha");
    // id defaults to 220px, so name starts at 48 + 220 = 268px.
    const nameBodyCell = screen.getByText("alpha").closest("td");
    expect(nameBodyCell?.style.left).toBe("268px");

    const handle = await screen.findByLabelText("Resize column id");
    fireEvent.mouseDown(handle, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 280 });

    // The following column tracks the cursor before release.
    expect(nameBodyCell?.style.left).toBe("348px");

    fireEvent.mouseUp(document);
    expect(screen.getByText("alpha").closest("td")?.style.left).toBe("348px");
  });

  it("centers row selection checkboxes like the header select-all", async () => {
    const { container } = renderEditor();

    await screen.findByText("alpha");
    const headerCell = container.querySelector("thead th");
    expect(headerCell?.className).toContain("justify-center");
    const selectionCells = Array.from(
      container.querySelectorAll("tbody td")
    ).filter((td) => td.querySelector('[role="checkbox"]'));
    expect(selectionCells.length).toBeGreaterThan(0);
    for (const cell of selectionCells) {
      expect(cell.className).toContain("justify-center");
    }
  });
});
