# Preços e Cotações

O cadastro técnico do insumo permanece em `engineering_inputs`. Cada registro em `engineering_input_prices` representa uma cotação ou preço histórico.

## Regra de adoção

- pode existir apenas um preço corporativo adotado por insumo;
- pode existir apenas um preço adotado por insumo em cada obra;
- adotar uma nova cotação preserva as anteriores e remove somente a marcação de referência;
- preços inativos nunca permanecem adotados;
- o preço final unitário é calculado por:

`preço base × (1 − desconto %) + frete unitário + outros custos unitários`
