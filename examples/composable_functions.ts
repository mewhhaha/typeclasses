import { fn } from "../src/fn.ts";
import { type Predicate, predicate } from "../src/predicate.ts";
import { Category, Profunctor } from "../src/typeclasses.ts";

const shipping_cents_by_country = {
  DE: 1_500,
  PL: 1_000,
  US: 3_000,
} as const;

type SupportedCountry = keyof typeof shipping_cents_by_country;

export type OrderPricingRequest = {
  readonly order: {
    readonly id: string;
    readonly destination_country: string;
    readonly item_count: number;
    readonly subtotal_cents: number;
    readonly expedited: boolean;
  };
};

export type OrderPricingResult =
  | {
    readonly status: "quoted";
    readonly order_id: string;
    readonly subtotal_cents: number;
    readonly shipping_cents: number;
    readonly total_cents: number;
    readonly summary: string;
  }
  | {
    readonly status: "rejected";
    readonly order_id: string;
    readonly reasons: readonly string[];
    readonly summary: string;
  };

type OrderPricingInput = OrderPricingRequest["order"];

type NormalizedOrder = {
  readonly id: string;
  readonly destination_country: string;
  readonly item_count: number;
  readonly subtotal_cents: number;
  readonly expedited: boolean;
};

type OrderQuote = {
  readonly order_id: string;
  readonly subtotal_cents: number;
  readonly shipping_cents: number;
  readonly total_cents: number;
};

type OrderPricingDecision =
  | {
    readonly status: "quoted";
    readonly quote: OrderQuote;
  }
  | {
    readonly status: "rejected";
    readonly order_id: string;
    readonly reasons: readonly string[];
  };

type OrderPricingPolicy = {
  readonly accepts: Predicate<NormalizedOrder>;
  readonly rejection_reason: (order: NormalizedOrder) => string;
};

const non_blank_text = predicate((value: string) => value.length > 0);
const positive_safe_integer = predicate((value: number) => {
  return Number.isSafeInteger(value) && value > 0;
});
const supported_country = predicate((value: string) => {
  return Object.hasOwn(shipping_cents_by_country, value);
});

const order_has_id = non_blank_text.contramap((order: NormalizedOrder) => {
  return order.id;
});
const order_has_items = positive_safe_integer.contramap(
  (order: NormalizedOrder) => order.item_count,
);
const order_has_subtotal = positive_safe_integer.contramap(
  (order: NormalizedOrder) => order.subtotal_cents,
);
const order_has_supported_destination = supported_country.contramap(
  (order: NormalizedOrder) => order.destination_country,
);

const order_pricing_policies = [
  {
    accepts: order_has_id,
    rejection_reason: () => "order id is blank",
  },
  {
    accepts: order_has_items,
    rejection_reason: (order) => {
      return "item_count " + order.item_count.toString() +
        " must be a positive safe integer";
    },
  },
  {
    accepts: order_has_subtotal,
    rejection_reason: (order) => {
      return "subtotal_cents " + order.subtotal_cents.toString() +
        " must be a positive safe integer";
    },
  },
  {
    accepts: order_has_supported_destination,
    rejection_reason: (order) => {
      return 'destination_country "' + order.destination_country +
        '" is not supported';
    },
  },
] as const satisfies readonly [OrderPricingPolicy, ...OrderPricingPolicy[]];

const order_can_be_priced = order_pricing_policies.slice(1).reduce(
  (combined, policy) => combined.concat(policy.accepts),
  order_pricing_policies[0].accepts,
);

const normalize_order = fn((order: OrderPricingInput): NormalizedOrder => {
  return {
    ...order,
    id: order.id.trim(),
    destination_country: order.destination_country.trim().toUpperCase(),
  };
});

const decide_order_pricing = fn(
  (order: NormalizedOrder): OrderPricingDecision => {
    if (!order_can_be_priced.run(order)) {
      const reasons = order_pricing_policies.flatMap((policy) => {
        if (policy.accepts.run(order)) {
          return [];
        }

        return [policy.rejection_reason(order)];
      });

      return {
        status: "rejected",
        order_id: order.id,
        reasons,
      };
    }

    const country = order.destination_country as SupportedCountry;
    const standard_shipping_cents = order.subtotal_cents >= 10_000
      ? 0
      : shipping_cents_by_country[country];
    const expedited_shipping_cents = order.expedited ? 750 : 0;
    const shipping_cents = standard_shipping_cents +
      expedited_shipping_cents;

    return {
      status: "quoted",
      quote: {
        order_id: order.id,
        subtotal_cents: order.subtotal_cents,
        shipping_cents,
        total_cents: order.subtotal_cents + shipping_cents,
      },
    };
  },
);

const price_order_input = Category.compose(
  decide_order_pricing,
  normalize_order,
);

const price_order_request = Profunctor.dimap(
  price_order_input,
  (request: OrderPricingRequest) => request.order,
  (decision): OrderPricingResult => {
    switch (decision.status) {
      case "quoted": {
        const quote = decision.quote;

        return {
          status: "quoted",
          order_id: quote.order_id,
          subtotal_cents: quote.subtotal_cents,
          shipping_cents: quote.shipping_cents,
          total_cents: quote.total_cents,
          summary: "order " + quote.order_id + ": " +
            format_cents(quote.subtotal_cents) + " + " +
            format_cents(quote.shipping_cents) + " shipping = " +
            format_cents(quote.total_cents),
        };
      }
      case "rejected": {
        const order_id = decision.order_id.length > 0
          ? decision.order_id
          : "<missing>";

        return {
          status: "rejected",
          order_id: decision.order_id,
          reasons: decision.reasons,
          summary: "order " + order_id + " rejected: " +
            decision.reasons.join("; "),
        };
      }
    }
  },
);

export function price_order(
  request: OrderPricingRequest,
): OrderPricingResult {
  return price_order_request.run(request);
}

export function run_composable_function_examples() {
  const free_shipping = price_order({
    order: {
      id: " order-42 ",
      destination_country: " pl ",
      item_count: 2,
      subtotal_cents: 12_000,
      expedited: false,
    },
  });
  const expedited_shipping = price_order({
    order: {
      id: "order-43",
      destination_country: "de",
      item_count: 1,
      subtotal_cents: 4_000,
      expedited: true,
    },
  });
  const rejected = price_order({
    order: {
      id: "  ",
      destination_country: "fr",
      item_count: 0,
      subtotal_cents: -1,
      expedited: false,
    },
  });

  console.log("composable functions free shipping", free_shipping);
  console.log("composable functions expedited shipping", expedited_shipping);
  console.log("composable functions rejected", rejected);
}

function format_cents(value: number): string {
  return "$" + (value / 100).toFixed(2);
}
