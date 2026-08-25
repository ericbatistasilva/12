// Array para armazenar os itens do carrinho
let carrinho = [];

// Seleciona todos os botões "Adicionar ao Carrinho"
const botoesAdd = document.querySelectorAll('.add-carrinho');
const carrinhoBtn = document.getElementById('carrinho-btn');

// Adiciona evento de clique aos botões
botoesAdd.forEach(botao => {
    botao.addEventListener('click', () => {
        const nome = botao.getAttribute('data-nome');
        const preco = parseFloat(botao.getAttribute('data-preco'));

        // Adiciona ao carrinho
        carrinho.push({ nome, preco });

        // Atualiza o contador do carrinho
        atualizarCarrinho();

        // Exibe mensagem de confirmação
        alert(`"${nome}" foi adicionado ao carrinho!`);
    });
});

// Atualiza o contador do carrinho
function atualizarCarrinho() {
    carrinhoBtn.textContent = `🛒 Carrinho (${carrinho.length})`;
}

// (Opcional: Exibir carrinho ao clicar no botão)
carrinhoBtn.addEventListener('click', () => {
    if (carrinho.length === 0) {
        alert("Seu carrinho está vazio!");
    } else {
        let mensagem = "Itens no carrinho:\n\n";
        let total = 0;
        carrinho.forEach((item, index) => {
            mensagem += `${index + 1}. ${item.nome} - R$ ${item.preco.toFixed(2).replace('.', ',')}\n`;
            total += item.preco;
        });
        mensagem += `\nTotal: R$ ${total.toFixed(2).replace('.', ',')}`;
        alert(mensagem);
    }
});
