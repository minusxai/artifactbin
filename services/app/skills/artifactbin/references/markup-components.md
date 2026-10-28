---
name: markup-components
description: >-
  Composes kit components in static JSX.
---
## Read first

Kit components compose through their root, item, trigger and content tags.
Use distinct `value` props for Accordion items. With `type="single"`,
`collapsible` lets the open item close when selected again.

## FAQ with an Accordion

```jsx
<Accordion type="single" collapsible>
  <AccordionItem value="shipping">
    <AccordionTrigger>How long does shipping take?</AccordionTrigger>
    <AccordionContent>Orders arrive in three to five business days.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="returns">
    <AccordionTrigger>Can I return an order?</AccordionTrigger>
    <AccordionContent>Unused items can be returned within 30 days.</AccordionContent>
  </AccordionItem>
</Accordion>
```
