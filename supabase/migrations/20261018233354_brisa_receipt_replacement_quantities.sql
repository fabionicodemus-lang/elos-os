-- Rejected deliveries do not fulfill an order; replacements may raise gross
-- received quantity above the ordered quantity. Keep the net delivery cap.
begin;
alter table public.procurement_purchase_order_items
  drop constraint if exists procurement_purchase_order_item_values_check;
alter table public.procurement_purchase_order_items
  add constraint procurement_purchase_order_item_values_check check (
    ordered_quantity > 0 and received_quantity >= 0 and accepted_quantity >= 0 and rejected_quantity >= 0 and cancelled_quantity >= 0 and
    received_quantity - rejected_quantity <= ordered_quantity + 0.000001 and
    accepted_quantity + rejected_quantity <= received_quantity + 0.000001 and
    cancelled_quantity <= ordered_quantity - (received_quantity - rejected_quantity) + 0.000001 and
    unit_price >= 0 and freight_amount >= 0 and other_cost_amount >= 0 and delivered_unit_cost >= 0 and total_amount >= 0
  );
commit;
