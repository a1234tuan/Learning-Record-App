import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { ChevronDown, ChevronRight, Copy, GitBranch, Plus, Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createBlankStructureNode,
  createComparisonColumn,
  createComparisonRow,
  createDefaultComparisonTable,
  createDefaultStickyBoard,
  createDefaultStructureDiagram,
  createStickyNote,
  parseComparisonTableData,
  parseStickyBoardData,
  parseStructureDiagramData,
  serializeStructureData,
  stickyTypeLabels,
  type ComparisonColumn,
  type ComparisonTableData,
  type StickyBoardData,
  type StickyNoteType,
  type StructureDiagramData,
  type StructureDiagramNode,
} from "../lib/recordStructureBlocks";

type UpdateAttributes = NodeViewProps["updateAttributes"];

const nodeData = (node: NodeViewProps["node"]): string => String(node.attrs.data ?? "");

const commitData = (updateAttributes: UpdateAttributes, data: unknown) => {
  updateAttributes({ data: serializeStructureData(data) });
};

const nodeRange = ({ editor, getPos, node }: Pick<NodeViewProps, "editor" | "getPos" | "node">) => {
  if (typeof getPos !== "function") {
    return undefined;
  }
  const from = getPos();
  return { from, to: from + node.nodeSize };
};

const duplicateNode = ({ editor, getPos, node }: Pick<NodeViewProps, "editor" | "getPos" | "node">) => {
  const range = nodeRange({ editor, getPos, node });
  if (!range) {
    return;
  }
  editor.chain().focus().insertContentAt(range.to, node.toJSON()).run();
};

const deleteNode = ({ editor, getPos, node }: Pick<NodeViewProps, "editor" | "getPos" | "node">) => {
  const range = nodeRange({ editor, getPos, node });
  if (!range) {
    return;
  }
  editor.chain().focus().deleteRange(range).run();
};

const moveNode = ({ editor, getPos, node }: Pick<NodeViewProps, "editor" | "getPos" | "node">, direction: -1 | 1) => {
  if (typeof getPos !== "function") {
    return;
  }
  const pos = getPos();
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const sibling = direction < 0 ? parent.maybeChild(index - 1) : parent.maybeChild(index + 1);
  if (!sibling) {
    return;
  }
  const from = direction < 0 ? pos - sibling.nodeSize : pos;
  const to = direction < 0 ? pos + node.nodeSize : pos + node.nodeSize + sibling.nodeSize;
  const nodes = direction < 0 ? [node, sibling] : [sibling, node];
  const transaction = editor.state.tr.replaceWith(from, to, Fragment.fromArray(nodes.map((item) => item.copy(item.content))));
  editor.view.dispatch(transaction);
  editor.commands.focus();
};

const BlockToolbar = (props: NodeViewProps) => {
  if (!props.editor.isEditable) {
    return null;
  }
  return (
    <div className="structure-block-toolbar" contentEditable={false}>
      <button type="button" title="复制" onClick={() => duplicateNode(props)}>
        <Copy size={14} />
      </button>
      <button type="button" title="上移" onClick={() => moveNode(props, -1)}>
        <ArrowUp size={14} />
      </button>
      <button type="button" title="下移" onClick={() => moveNode(props, 1)}>
        <ArrowDown size={14} />
      </button>
      <button type="button" title="删除" className="danger" onClick={() => deleteNode(props)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
};

const textValue = (value: unknown): string => typeof value === "string" ? value : "";

const mapChainForNode = (
  chain: StructureDiagramNode[],
  nodeId: string,
  mapper: (chain: StructureDiagramNode[], index: number) => StructureDiagramNode[],
): StructureDiagramNode[] => {
  const index = chain.findIndex((node) => node.id === nodeId);
  if (index >= 0) {
    return mapper(chain, index);
  }
  return chain.map((node) => ({
    ...node,
    branches: node.branches.map((branch) => mapChainForNode(branch, nodeId, mapper)),
  }));
};

const updateDiagramNode = (
  chain: StructureDiagramNode[],
  nodeId: string,
  mapper: (node: StructureDiagramNode) => StructureDiagramNode,
): StructureDiagramNode[] =>
  chain.map((node) => {
    if (node.id === nodeId) {
      return mapper(node);
    }
    return { ...node, branches: node.branches.map((branch) => updateDiagramNode(branch, nodeId, mapper)) };
  });

const ensureChain = (chain: StructureDiagramNode[]) => chain.length > 0 ? chain : [createBlankStructureNode()];

const StructureDiagramNodeEditor = ({
  chain,
  node,
  editable,
  depth,
  onChange,
}: {
  chain: StructureDiagramNode[];
  node: StructureDiagramNode;
  editable: boolean;
  depth: number;
  onChange: (chain: StructureDiagramNode[]) => void;
}) => {
  const patchNode = (patch: Partial<StructureDiagramNode>) => {
    onChange(updateDiagramNode(chain, node.id, (current) => ({ ...current, ...patch })));
  };
  const insertAfter = () => {
    onChange(mapChainForNode(chain, node.id, (current, index) => [
      ...current.slice(0, index + 1),
      createBlankStructureNode(),
      ...current.slice(index + 1),
    ]));
  };
  const addBranch = () => {
    patchNode({ branches: [...node.branches, [createBlankStructureNode()]] });
  };
  const deleteCurrent = () => {
    onChange(ensureChain(mapChainForNode(chain, node.id, (current, index) => [
      ...current.slice(0, index),
      ...current.slice(index + 1),
    ])));
  };
  const moveCurrent = (direction: -1 | 1) => {
    onChange(mapChainForNode(chain, node.id, (current, index) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    }));
  };

  if (!editable) {
    return (
      <div className="structure-node-view" style={{ "--structure-depth": depth } as React.CSSProperties}>
        <strong>{node.title || "未命名节点"}</strong>
        {node.body && <p>{node.body}</p>}
        {node.note && <span>旁注：{node.note}</span>}
        {node.pitfall && <small>易错：{node.pitfall}</small>}
        {node.branches.map((branch, index) => (
          <div key={`${node.id}-branch-${index}`} className="structure-branch-view">
            {branch.map((branchNode) => (
              <StructureDiagramNodeEditor
                key={branchNode.id}
                chain={branch}
                node={branchNode}
                editable={false}
                depth={depth + 1}
                onChange={() => undefined}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="structure-node-editor" style={{ "--structure-depth": depth } as React.CSSProperties}>
      <div className="structure-node-fields">
        <input value={node.title} placeholder="节点标题" onChange={(event) => patchNode({ title: event.target.value })} />
        <textarea value={node.body} placeholder="一句话说明" onChange={(event) => patchNode({ body: event.target.value })} />
        <input value={node.note} placeholder="旁注/类比，如：门卫" onChange={(event) => patchNode({ note: event.target.value })} />
        <input value={node.pitfall} placeholder="易错点" onChange={(event) => patchNode({ pitfall: event.target.value })} />
      </div>
      <div className="structure-node-actions">
        <button type="button" onClick={insertAfter}>
          <Plus size={14} /> 后续
        </button>
        <button type="button" onClick={addBranch}>
          <GitBranch size={14} /> 分叉
        </button>
        <button type="button" onClick={() => moveCurrent(-1)}>
          <ArrowUp size={14} />
        </button>
        <button type="button" onClick={() => moveCurrent(1)}>
          <ArrowDown size={14} />
        </button>
        <button type="button" className="danger" onClick={deleteCurrent}>
          <Trash2 size={14} />
        </button>
      </div>
      {node.branches.map((branch, index) => (
        <div key={`${node.id}-branch-${index}`} className="structure-branch-editor">
          <span>分叉 {index + 1}</span>
          {branch.map((branchNode) => (
            <StructureDiagramNodeEditor
              key={branchNode.id}
              chain={branch}
              node={branchNode}
              editable
              depth={depth + 1}
              onChange={(nextBranch) => {
                patchNode({
                  branches: node.branches.map((item, branchIndex) => branchIndex === index ? nextBranch : item),
                });
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const StructureDiagramViewCard = ({ node }: { node: StructureDiagramNode }) => (
  <div className="structure-flow-card">
    <strong>{node.title || "未命名节点"}</strong>
    {node.body && <p>{node.body}</p>}
    {node.note && <span>旁注：{node.note}</span>}
    {node.pitfall && <small>易错：{node.pitfall}</small>}
  </div>
);

const StructureDiagramFlowChain = ({ chain }: { chain: StructureDiagramNode[] }) => (
  <div className="structure-flow-chain">
    {chain.map((node, index) => (
      <div key={node.id} className="structure-flow-step">
        <div className="structure-flow-step-main">
          <StructureDiagramViewCard node={node} />
          {index < chain.length - 1 && <span className="structure-flow-arrow">→</span>}
        </div>
        {node.branches.length > 0 && (
          <div className="structure-flow-branches">
            {node.branches.map((branch, branchIndex) => (
              <div key={`${node.id}-flow-branch-${branchIndex}`} className="structure-flow-branch">
                <span className="structure-flow-branch-stem" aria-hidden="true" />
                <StructureDiagramFlowChain chain={branch} />
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
);

const StructureDiagramNodeView = (props: NodeViewProps) => {
  const data = parseStructureDiagramData(nodeData(props.node));
  const editable = props.editor.isEditable;
  const update = (next: StructureDiagramData) => commitData(props.updateAttributes, next);

  return (
    <NodeViewWrapper className={`structure-block structure-diagram-block${props.selected ? " selected" : ""}`} data-structure-kind="diagram">
      <BlockToolbar {...props} />
      {editable ? (
        <>
          <div className="structure-block-head" contentEditable={false}>
            <input value={data.title} onChange={(event) => update({ ...data, title: event.target.value })} />
            <select
              value={data.orientation}
              onChange={(event) => update({ ...data, orientation: event.target.value === "horizontal" ? "horizontal" : "vertical" })}
            >
              <option value="vertical">竖向</option>
              <option value="horizontal">横向</option>
            </select>
          </div>
          <div className="structure-chain-editor">
            {data.chain.map((node) => (
              <StructureDiagramNodeEditor
                key={node.id}
                chain={data.chain}
                node={node}
                editable
                depth={0}
                onChange={(chain) => update({ ...data, chain: ensureChain(chain) })}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <h3>{data.title}</h3>
          {data.orientation === "horizontal" ? (
            <div className="structure-flow-view">
              <StructureDiagramFlowChain chain={data.chain} />
            </div>
          ) : (
            <div className="structure-chain-view vertical">
              {data.chain.map((node) => (
                <StructureDiagramNodeEditor key={node.id} chain={data.chain} node={node} editable={false} depth={0} onChange={() => undefined} />
              ))}
            </div>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
};

const ComparisonTableNodeView = (props: NodeViewProps) => {
  const data = parseComparisonTableData(nodeData(props.node));
  const editable = props.editor.isEditable;
  const update = (next: ComparisonTableData) => commitData(props.updateAttributes, next);
  const addColumn = () => {
    const column = createComparisonColumn();
    update({
      ...data,
      columns: [...data.columns, column],
      rows: data.rows.map((row) => ({ ...row, cells: { ...row.cells, [column.id]: "" } })),
    });
  };
  const removeColumn = (columnId: string) => {
    if (data.columns.length <= 1) {
      return;
    }
    update({
      ...data,
      columns: data.columns.filter((column) => column.id !== columnId),
      rows: data.rows.map((row) => {
        const { [columnId]: _removed, ...cells } = row.cells;
        return { ...row, cells };
      }),
    });
  };
  const updateColumn = (columnId: string, label: string) => update({
    ...data,
    columns: data.columns.map((column) => column.id === columnId ? { ...column, label } : column),
  });
  const updateCell = (rowId: string, columnId: string, value: string) => update({
    ...data,
    rows: data.rows.map((row) => row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row),
  });
  const moveRow = (rowId: string, direction: -1 | 1) => {
    const index = data.rows.findIndex((row) => row.id === rowId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.rows.length) {
      return;
    }
    const rows = [...data.rows];
    [rows[index], rows[target]] = [rows[target], rows[index]];
    update({ ...data, rows });
  };

  return (
    <NodeViewWrapper className={`structure-block comparison-block${props.selected ? " selected" : ""}`} data-structure-kind="comparison">
      <BlockToolbar {...props} />
      {editable ? (
        <>
          <div className="structure-block-head" contentEditable={false}>
            <input value={data.title} onChange={(event) => update({ ...data, title: event.target.value })} />
            <button type="button" onClick={() => update({ ...data, rows: [...data.rows, createComparisonRow(data.columns)] })}>加行</button>
            <button type="button" onClick={addColumn}>加列</button>
          </div>
          <div className="comparison-editor">
            <div className="comparison-column-editor">
              {data.columns.map((column) => (
                <label key={column.id}>
                  <input value={column.label} onChange={(event) => updateColumn(column.id, event.target.value)} />
                  <button type="button" className="danger" onClick={() => removeColumn(column.id)}>删列</button>
                </label>
              ))}
            </div>
            {data.rows.map((row, rowIndex) => (
              <article key={row.id} className="comparison-row-card">
                <header>
                  <strong>第 {rowIndex + 1} 行</strong>
                  <span>
                    <button type="button" onClick={() => moveRow(row.id, -1)}>上移</button>
                    <button type="button" onClick={() => moveRow(row.id, 1)}>下移</button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => update({ ...data, rows: data.rows.length > 1 ? data.rows.filter((item) => item.id !== row.id) : data.rows })}
                    >
                      删除
                    </button>
                  </span>
                </header>
                {data.columns.map((column) => (
                  <label key={column.id}>
                    <span>{column.label}</span>
                    <textarea value={row.cells[column.id] ?? ""} onChange={(event) => updateCell(row.id, column.id, event.target.value)} />
                  </label>
                ))}
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <h3>{data.title}</h3>
          <div className="comparison-table-scroll">
            <table className="comparison-table-view">
              <thead>
                <tr>
                  {data.columns.map((column, columnIndex) => (
                    <th key={column.id} className={columnIndex === 0 ? "sticky-column" : undefined}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    {data.columns.map((column, columnIndex) => {
                      const value = row.cells[column.id]?.trim();
                      return (
                        <td key={column.id} className={columnIndex === 0 ? "sticky-column" : undefined}>
                          {value || <span className="empty-cell">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </NodeViewWrapper>
  );
};

const StickyBoardNodeView = (props: NodeViewProps) => {
  const data = parseStickyBoardData(nodeData(props.node));
  const editable = props.editor.isEditable;
  const update = (next: StickyBoardData) => commitData(props.updateAttributes, next);
  const grouped = useMemo(() => {
    const groups = new Map<StickyNoteType, StickyBoardData["notes"]>();
    for (const type of Object.keys(stickyTypeLabels) as StickyNoteType[]) {
      groups.set(type, data.notes.filter((note) => note.type === type));
    }
    return groups;
  }, [data.notes]);
  const updateNote = (noteId: string, patch: Partial<StickyBoardData["notes"][number]>) => update({
    ...data,
    notes: data.notes.map((note) => note.id === noteId ? { ...note, ...patch } : note),
  });
  const moveNote = (noteId: string, direction: -1 | 1) => {
    const index = data.notes.findIndex((note) => note.id === noteId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.notes.length) {
      return;
    }
    const notes = [...data.notes];
    [notes[index], notes[target]] = [notes[target], notes[index]];
    update({ ...data, notes });
  };
  const toggleGroup = (type: StickyNoteType) => {
    const collapsed = data.collapsedTypes.includes(type)
      ? data.collapsedTypes.filter((item) => item !== type)
      : [...data.collapsedTypes, type];
    update({ ...data, collapsedTypes: collapsed });
  };

  return (
    <NodeViewWrapper className={`structure-block sticky-board-block${props.selected ? " selected" : ""}`} data-structure-kind="sticky">
      <BlockToolbar {...props} />
      {editable ? (
        <>
          <div className="structure-block-head" contentEditable={false}>
            <input value={data.title} onChange={(event) => update({ ...data, title: event.target.value })} />
            <button type="button" onClick={() => update({ ...data, notes: [...data.notes, createStickyNote()] })}>加便签</button>
          </div>
          <div className="sticky-board-editor">
            {(Object.keys(stickyTypeLabels) as StickyNoteType[]).map((type) => {
              const notes = grouped.get(type) ?? [];
              const collapsed = data.collapsedTypes.includes(type);
              return (
                <section key={type} className="sticky-group">
                  <button type="button" className="sticky-group-title" onClick={() => toggleGroup(type)}>
                    {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    {stickyTypeLabels[type]} <span>{notes.length}</span>
                  </button>
                  {!collapsed && notes.map((note) => (
                    <article key={note.id} className={`sticky-note sticky-${note.type}`}>
                      <select value={note.type} onChange={(event) => updateNote(note.id, { type: event.target.value as StickyNoteType })}>
                        {(Object.keys(stickyTypeLabels) as StickyNoteType[]).map((item) => (
                          <option key={item} value={item}>{stickyTypeLabels[item]}</option>
                        ))}
                      </select>
                      <textarea value={note.text} placeholder="写下一个想法" onChange={(event) => updateNote(note.id, { text: event.target.value })} />
                      <div>
                        <button type="button" onClick={() => moveNote(note.id, -1)}>上移</button>
                        <button type="button" onClick={() => moveNote(note.id, 1)}>下移</button>
                        <button type="button" className="danger" onClick={() => update({ ...data, notes: data.notes.filter((item) => item.id !== note.id) })}>
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <h3>{data.title}</h3>
          <div className="sticky-board-view">
            {data.notes.filter((note) => note.text.trim()).map((note) => (
              <article key={note.id} className={`sticky-note sticky-${note.type}`}>
                <strong>{stickyTypeLabels[note.type]}</strong>
                <p>{note.text}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </NodeViewWrapper>
  );
};

const CollapseBlockNodeView = (props: NodeViewProps) => {
  const editable = props.editor.isEditable;
  const defaultOpen = Boolean(props.node.attrs.defaultOpen);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <NodeViewWrapper className={`structure-block collapse-block${props.selected ? " selected" : ""}`} data-structure-kind="collapse">
      <BlockToolbar {...props} />
      <div className="collapse-block-head" contentEditable={false}>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "收起折叠块" : "展开折叠块"}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {editable ? (
          <>
            <input value={textValue(props.node.attrs.title)} placeholder="折叠块标题" onChange={(event) => props.updateAttributes({ title: event.target.value })} />
            <input value={textValue(props.node.attrs.summary)} placeholder="摘要标签" onChange={(event) => props.updateAttributes({ summary: event.target.value })} />
            <label>
              <input
                type="checkbox"
                checked={defaultOpen}
                onChange={(event) => props.updateAttributes({ defaultOpen: event.target.checked })}
              />
              默认展开
            </label>
          </>
        ) : (
          <>
            <strong>{textValue(props.node.attrs.title) || "折叠内容"}</strong>
            {props.node.attrs.summary && <span>{textValue(props.node.attrs.summary)}</span>}
          </>
        )}
      </div>
      <NodeViewContent className="collapse-block-content" style={{ display: open ? undefined : "none" }} />
    </NodeViewWrapper>
  );
};

export const RecordStructureDiagramNode = Node.create({
  name: "recordStructureDiagram",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: serializeStructureData(createDefaultStructureDiagram()),
        parseHTML: (element) => element.getAttribute("data-json") ?? "",
        renderHTML: (attributes) => ({ "data-json": attributes.data }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-structure-diagram" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-structure-diagram", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StructureDiagramNodeView);
  },
});

export const RecordComparisonTableNode = Node.create({
  name: "recordComparisonTable",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: serializeStructureData(createDefaultComparisonTable()),
        parseHTML: (element) => element.getAttribute("data-json") ?? "",
        renderHTML: (attributes) => ({ "data-json": attributes.data }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-comparison-table" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-comparison-table", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComparisonTableNodeView);
  },
});

export const RecordStickyBoardNode = Node.create({
  name: "recordStickyBoard",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: serializeStructureData(createDefaultStickyBoard()),
        parseHTML: (element) => element.getAttribute("data-json") ?? "",
        renderHTML: (attributes) => ({ "data-json": attributes.data }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-sticky-board" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-sticky-board", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StickyBoardNodeView);
  },
});

export const RecordCollapseBlockNode = Node.create({
  name: "recordCollapseBlock",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      title: {
        default: "折叠块",
        parseHTML: (element) => element.getAttribute("data-title") ?? "折叠块",
        renderHTML: (attributes) => ({ "data-title": attributes.title }),
      },
      summary: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-summary") ?? "",
        renderHTML: (attributes) => ({ "data-summary": attributes.summary }),
      },
      defaultOpen: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-default-open") === "true",
        renderHTML: (attributes) => ({ "data-default-open": attributes.defaultOpen ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-collapse" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-collapse", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollapseBlockNodeView);
  },
});
