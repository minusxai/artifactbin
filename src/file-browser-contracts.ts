export interface FileSelection {
  paths: string[];
  anchor: string | null;
}
export interface SelectionGesture {
  path: string;
  visible: string[];
  toggle?: boolean;
  range?: boolean;
}
export interface MoveMany {
  kind: "move-many";
  paths: string[];
  destination: string;
}
