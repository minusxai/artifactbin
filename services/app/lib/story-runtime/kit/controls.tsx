/**
 * The `controls` kit chunk: the bound-control kit (components/kit/controls),
 * as its static faces and as the runtime's live adapters — resolved from the
 * store, writing back typed — plus the controls an editable table cell draws
 * with (StoryRuntimeApp RuntimeCellControl).
 */
import { useContext, type ReactNode } from 'react';
import { DateControl, DatePicker, Input, Segmented, SegmentedControl, Select, SelectControl, Slider, SliderControl, Switch, SwitchControl, Textarea, TextControl, attrScalar, fieldLabel, inputType, normalizeControlOptions, num, shellRest, str, textRest } from '@/components/kit/controls';
import { coerceScalarInput, refName, type DataflowState } from '@/lib/story/dataflow';
import { FrozenHint, RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

/** Authored options choose rows; user labels only use already-visible person cards.
 * Without options, retain the server's field-scoped choices. This is presentation,
 * never authorization: user constraints remain enforced at the write boundary. */
export function selectOptions(state: DataflowState, raw: unknown, field: string, isUser: boolean) {
  if (raw === undefined && isUser) return state.userOptions?.[field] ?? [];
  const name = refName(raw);
  const table = name ? state.tables[name] : undefined;
  const options = normalizeControlOptions(raw, table);
  return isUser && (!table || table.columns.length === 1)
    ? options.map(option => ({...option, label: option.label === option.value ? state.people?.[option.value]?.name ?? option.label : option.label}))
    : options;
}

/**
 * The live wiring every kit control adapter shares: the bound scalar's
 * declaration (for typed coercion and the "all" entry), its current value as
 * a control-facing string, and the typed writer. `name` null (an unbound
 * control in a live document) leaves `write` undefined — the control renders
 * disabled, same as the static face. A `continuous` control (typing, a
 * slider) debounces the queries it feeds; every other one runs them at once.
 */
function useScalarControl(name: string | null, continuous = false) {
  const { flow, state, setValue, store } = useContext(RuntimeEmbedContext);
  const decl = name ? flow.values.find((v) => v.kind === 'scalar' && v.name === name) : undefined;
  return {
    state,
    /** Why this Value's control must not move on this render (an offline file), or null. */
    frozen: name !== null && store ? store.frozenReason(name) : null,
    type: decl?.type,
    nullable: name !== null && (decl?.default ?? null) === null,
    current: name !== null && state.values[name] !== null && state.values[name] !== undefined ? String(state.values[name]) : null,
    write: name === null ? undefined : (raw: string | null) => setValue(name, raw === null ? null : coerceScalarInput(decl?.type, raw), { debounce: continuous }),
    writeBool: name === null ? undefined : (next: boolean) => setValue(name, next),
    isTrue: name !== null && state.values[name] === true,
    asNumber: name !== null && typeof state.values[name] === 'number' ? (state.values[name] as number) : null,
  };
}

/**
 * The live `<Input>`/`<Textarea>`: a real text field showing the bound scalar
 * and writing it back typed on every keystroke, which is what makes
 * `<Mutation reset>` able to empty it — the control holds nothing of its own.
 */
function InputAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value), true);
  return (
    <FrozenHint reason={bind.frozen}><TextControl
      label={str(props.label)} ariaLabel={fieldLabel(props)} className={str(props.className)}
      type={inputType(props.type)} placeholder={str(props.placeholder)}
      min={attrScalar(props.min)} max={attrScalar(props.max)} step={attrScalar(props.step)}
      required={props.required === true} autoFocus={props.autoFocus === true}
      value={bind.current} disabled={props.disabled === true || !!bind.frozen} description={bind.frozen ?? undefined}
      onChange={bind.write} rest={textRest(props)}
    /></FrozenHint>
  );
}

function TextareaAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value), true);
  return (
    <FrozenHint reason={bind.frozen}><TextControl
      label={str(props.label)} ariaLabel={fieldLabel(props)} className={str(props.className)}
      placeholder={str(props.placeholder)} multiline
      rows={typeof props.rows === 'number' ? props.rows : undefined}
      required={props.required === true} autoFocus={props.autoFocus === true}
      value={bind.current} disabled={props.disabled === true || !!bind.frozen} description={bind.frozen ?? undefined}
      onChange={bind.write} rest={textRest(props)}
    /></FrozenHint>
  );
}

function SelectAdapter(props: Record<string, unknown>) {
  const { state } = useContext(RuntimeEmbedContext);
  const bind = useScalarControl(refName(props.value));
  const userControl=Object.hasOwn(state.userOptions??{},refName(props.value)??'');
  const options = selectOptions(state, props.options, refName(props.value) ?? '', userControl);
  return (
    <FrozenHint reason={bind.frozen}><SelectControl
      label={str(props.label)} placeholder={str(props.placeholder)} className={str(props.className)}
      options={options} value={bind.current} nullable={bind.nullable}
      multiple={!userControl&&props.multiple === true} allowCreate={!userControl&&props.allowCreate === true} valueFormat={props.valueFormat === 'json' ? 'json' : undefined}
      disabled={!!bind.frozen} description={bind.frozen ?? undefined}
      onChange={bind.write} rest={shellRest(props)}
    >{props.children as ReactNode}</SelectControl></FrozenHint>
  );
}

function SegmentedAdapter(props: Record<string, unknown>) {
  const { state } = useContext(RuntimeEmbedContext);
  const bind = useScalarControl(refName(props.value));
  const optsName = refName(props.options);
  const options = normalizeControlOptions(props.options, optsName ? state.tables[optsName] : undefined);
  return (
    <FrozenHint reason={bind.frozen}><SegmentedControl
      label={str(props.label)} placeholder={str(props.placeholder)} className={str(props.className)}
      options={options} value={bind.current} nullable={bind.nullable}
      disabled={!!bind.frozen} description={bind.frozen ?? undefined}
      onChange={bind.write} rest={shellRest(props)}
    /></FrozenHint>
  );
}

function SliderAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value), true);
  return (
    <FrozenHint reason={bind.frozen}><SliderControl
      label={str(props.label)} className={str(props.className)}
      min={num(props.min, 0)} max={num(props.max, 100)}
      step={typeof props.step === 'number' ? props.step : undefined}
      format={str(props.format)} prefix={str(props.prefix)} suffix={str(props.suffix)}
      disabled={!!bind.frozen} description={bind.frozen ?? undefined}
      value={bind.asNumber} onChange={bind.write} rest={shellRest(props)}
    /></FrozenHint>
  );
}

function DatePickerAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value));
  return (
    <FrozenHint reason={bind.frozen}><DateControl
      label={str(props.label)} className={str(props.className)}
      min={str(props.min)} max={str(props.max)}
      disabled={!!bind.frozen} description={bind.frozen ?? undefined}
      value={bind.type==='timestamp'?bind.current?.slice(0,10)??null:bind.current} nullable={bind.nullable} onChange={bind.write} rest={shellRest(props)}
    /></FrozenHint>
  );
}

function SwitchAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(typeof props.checked === 'string' ? refName(props.checked) : null);
  return (
    <FrozenHint reason={bind.frozen}><SwitchControl
      label={str(props.label)} className={str(props.className)}
      disabled={!!bind.frozen} description={bind.frozen ?? undefined}
      checked={bind.isTrue} onChange={bind.writeBool} rest={shellRest(props)}
    /></FrozenHint>
  );
}

export const chunk: KitChunk = {
  faces: { Input, Textarea, Select, Slider, DatePicker, Segmented, Switch },
  live: {
    Input: InputAdapter,
    Textarea: TextareaAdapter,
    Select: SelectAdapter,
    Segmented: SegmentedAdapter,
    Slider: SliderAdapter,
    DatePicker: DatePickerAdapter,
    Switch: SwitchAdapter,
  },
  cells: { SelectControl, DateControl, selectOptions, shellRest },
};
