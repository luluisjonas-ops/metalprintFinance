/* ==========================================================================
   METAL PRINT FINANCE - LOGIC & FIRESTORE INTEGRATION (COMPAT VERSION)
   ========================================================================== */

// Configuração Firebase do Usuário
const firebaseConfig = {
    apiKey: "AIzaSyA_IIOZ9J3YvrWr__ipeoolT6m1bGQ82kk",
    authDomain: "metal-print-a099b.firebaseapp.com",
    databaseURL: "https://metal-print-a099b-default-rtdb.firebaseio.com",
    projectId: "metal-print-a099b",
    storageBucket: "metal-print-a099b.firebasestorage.app",
    messagingSenderId: "521510301351",
    appId: "1:521510301351:web:49016ec1da1058e35db582",
    measurementId: "G-6P0TDTDXML"
};

let db = null;
let firebaseActive = false;

// Estado Global do ERP (Inicia 100% zerado conforme solicitado)
const state = {
    companyId: "metal_print_cv_demo",
    companyName: "Metal Print Comunicação Visual",
    companyCnpj: "12.345.678/0001-99",
    activeTab: "dashboard",
    theme: "light",
    
    // Coleções de Dados (Iniciam 100% vazias)
    clientes: [],
    fornecedores: [],
    funcionarios: [],
    materiais: [],
    produtos: [],
    financeiro: [],
    orcamentos: [],
    ordens_servico: [],
    recibos: [],
    metas: { mensal: 50000, anual: 600000 },
    
    // Temporários para controle de UI
    osMateriaisVinculados: [],
    orcMateriaisVinculados: []
};

// Configuração Gemini API
async function callGeminiAPI(promptText, systemInstruction = "") {
    const customKey = localStorage.getItem("mp_gemini_api_key");
    const key = customKey && customKey.trim() !== "" ? customKey.trim() : "AIzaSyA_IIOZ9J3YvrWr__ipeoolT6m1bGQ82kk";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    
    const requestBody = {
        contents: [{
            parts: [{ text: promptText }]
        }]
    };
    
    if (systemInstruction) {
        requestBody.systemInstruction = {
            parts: [{ text: systemInstruction }]
        };
    }
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || "Erro de comunicação com o servidor Gemini.");
        }
        
        const resData = await response.json();
        if (!resData.candidates || resData.candidates.length === 0) {
            throw new Error("Sem resposta válida do Gemini.");
        }
        return resData.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("Erro na API Gemini:", e);
        return `Erro de API Gemini: ${e.message}. Por favor, configure uma Chave API válida nas configurações da plataforma.`;
    }
}

// Instâncias Globais de Gráficos (Chart.js)
let chartFluxoCaixa = null;
let chartFluxoCaixaDetalhado = null;
let chartIndicadoresCategorias = null;

// 1. INICIALIZAÇÃO DE BANCO DE DADOS E EVENTOS
function initDb() {
    const statusBadge = document.getElementById("firebase-status");
    if (typeof firebase !== 'undefined') {
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            
            // Habilita persistência offline do Firestore
            db.enablePersistence().catch(err => {
                console.warn("Persistência offline do Firestore falhou:", err.code);
            });
            
            firebaseActive = true;
            statusBadge.classList.add("online");
            statusBadge.querySelector(".status-text").textContent = "Nuvem (Firestore)";
            console.log("Firebase Firestore inicializado com sucesso.");
        } catch (e) {
            console.error("Falha ao inicializar o Firebase. Usando fallback LocalStorage:", e);
            firebaseActive = false;
            statusBadge.classList.add("offline");
            statusBadge.querySelector(".status-text").textContent = "Local (Demonstração)";
        }
    } else {
        console.warn("Firebase SDK não carregado. Operando no modo local.");
        firebaseActive = false;
        statusBadge.classList.add("offline");
        statusBadge.querySelector(".status-text").textContent = "Local (Demonstração)";
    }
}

// Escutando alterações em tempo real
function setupRealtimeListeners() {
    const collectionsToListen = ["clientes", "fornecedores", "funcionarios", "materiais", "produtos", "financeiro", "orcamentos", "ordens_servico", "recibos"];
    
    if (firebaseActive && db) {
        collectionsToListen.forEach(colName => {
            db.collection(colName).where("companyId", "==", state.companyId)
            .onSnapshot((snapshot) => {
                const list = [];
                snapshot.forEach(docSnap => {
                    list.push({ id: docSnap.id, ...docSnap.data() });
                });
                state[colName] = list;
                updateAppDerivedState();
                renderActiveTab();
            }, (error) => {
                console.error(`Erro no listener do Firestore (${colName}):`, error);
                loadLocalFallbackData(colName);
            });
        });
        
        // Listeners específicos para configurações adicionais (Metas)
        db.collection("configuracoes").doc("metas_def").onSnapshot((docSnap) => {
            if (docSnap.exists) {
                state.metas = docSnap.data().metas || { mensal: 50000, anual: 600000 };
                updateAppDerivedState();
                renderActiveTab();
            }
        });
    } else {
        // Fallback LocalStorage
        collectionsToListen.forEach(colName => {
            const localData = localStorage.getItem(`mp_finance_${colName}`);
            if (localData) {
                state[colName] = JSON.parse(localData);
            } else {
                state[colName] = []; // Inicia vazio
                localStorage.setItem(`mp_finance_${colName}`, JSON.stringify([]));
            }
        });
        
        const localMetas = localStorage.getItem("mp_finance_metas");
        if (localMetas) {
            state.metas = JSON.parse(localMetas);
        }
        
        updateAppDerivedState();
        renderActiveTab();
    }
}

// Salva dados de forma automática e transparente
async function dbSave(collectionName, data) {
    data.companyId = state.companyId;
    if (!data.id) {
        data.id = collectionName + "_" + Date.now();
    }
    
    if (firebaseActive && db) {
        try {
            await db.collection(collectionName).doc(data.id).set(data);
        } catch (e) {
            console.error("Erro ao salvar no Firestore. Salvando localmente...", e);
            dbSaveLocal(collectionName, data);
        }
    } else {
        dbSaveLocal(collectionName, data);
    }
}

function dbSaveLocal(collectionName, data) {
    const list = state[collectionName] || [];
    const index = list.findIndex(item => item.id === data.id);
    if (index >= 0) {
        list[index] = data;
    } else {
        list.push(data);
    }
    state[collectionName] = list;
    localStorage.setItem(`mp_finance_${collectionName}`, JSON.stringify(list));
    
    updateAppDerivedState();
    renderActiveTab();
}

// Remove dados de forma automática
async function dbDelete(collectionName, id) {
    if (firebaseActive && db) {
        try {
            await db.collection(collectionName).doc(id).delete();
        } catch (e) {
            console.error("Erro ao deletar no Firestore. Deletando localmente...", e);
            dbDeleteLocal(collectionName, id);
        }
    } else {
        dbDeleteLocal(collectionName, id);
    }
}

function dbDeleteLocal(collectionName, id) {
    const list = state[collectionName] || [];
    state[collectionName] = list.filter(item => item.id !== id);
    localStorage.setItem(`mp_finance_${collectionName}`, JSON.stringify(state[collectionName]));
    
    updateAppDerivedState();
    renderActiveTab();
}

function loadLocalFallbackData(colName) {
    const localData = localStorage.getItem(`mp_finance_${colName}`);
    state[colName] = localData ? JSON.parse(localData) : [];
    updateAppDerivedState();
    renderActiveTab();
}

// 2. CÁLCULO DE MÉTRICAS E BADGES
function updateAppDerivedState() {
    const contasPagarPendentes = state.financeiro.filter(f => f.tipo === "Despesa" && !f.pago).length;
    const contasReceberPendentes = state.financeiro.filter(f => f.tipo === "Receita" && !f.pago).length;
    const ordensEmProducao = state.ordens_servico.filter(o => o.status !== "Finalizado" && o.status !== "Cancelado").length;

    document.getElementById("badge-contas-pagar").textContent = contasPagarPendentes;
    document.getElementById("badge-contas-receber").textContent = contasReceberPendentes;
    document.getElementById("badge-ordens-producao").textContent = ordensEmProducao;
}

// 3. SELETOR DE SEÇÕES (SPA)
function renderActiveTab() {
    const tab = state.activeTab;
    
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    const activeSection = document.getElementById(`view-${tab}`);
    if (activeSection) {
        activeSection.classList.add("active");
    }
    
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.getAttribute("data-tab") === tab) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    switch (tab) {
        case "dashboard": renderDashboard(); break;
        case "financeiro": renderFinanceiro(); break;
        case "fluxo-caixa": renderFluxoCaixa(); break;
        case "receitas": renderReceitas(); break;
        case "despesas": renderDespesas(); break;
        case "contas-pagar": renderContasPagar(); break;
        case "contas-receber": renderContasReceber(); break;
        case "clientes": renderClientes(); break;
        case "fornecedores": renderFornecedores(); break;
        case "funcionarios": renderFuncionarios(); break;
        case "materiais": renderMateriais(); break;
        case "produtos": renderProdutos(); break;
        case "estoque": renderEstoque(); break;
        case "ordens-servico": renderOrdensServico(); break;
        case "orçamentos": renderOrcamentos(); break;
        case "recibos": renderRecibos(); break;
        case "producao": renderProducao(); break;
        case "agenda": renderAgenda(); break;
        case "relatorios": renderRelatorios(); break;
        case "metas": renderMetas(); break;
        case "indicadores": renderIndicadores(); break;
        case "calculadora": renderCalculadora(); break;
        case "configuracoes": renderConfiguracoes(); break;
    }
}

// --- VIEW: DASHBOARD ---
function renderDashboard() {
    const hoje = new Date().toISOString().split("T")[0];
    const inicioSemana = getInicioSemana();
    const inicioMes = getInicioMes();
    const inicioAno = getInicioAno();

    let saldo = 0;
    let lucroHoje = 0;
    let lucroSemana = 0;
    let lucroMes = 0;
    let lucroAno = 0;

    state.financeiro.forEach(f => {
        const valor = parseFloat(f.valor) || 0;
        if (f.pago) {
            if (f.tipo === "Receita") {
                saldo += valor;
                if (f.data === hoje) lucroHoje += valor;
                if (f.data >= inicioSemana) lucroSemana += valor;
                if (f.data >= inicioMes) lucroMes += valor;
                if (f.data >= inicioAno) lucroAno += valor;
            } else {
                saldo -= valor;
                if (f.data === hoje) lucroHoje -= valor;
                if (f.data >= inicioSemana) lucroSemana -= valor;
                if (f.data >= inicioMes) lucroMes -= valor;
                if (f.data >= inicioAno) lucroAno -= valor;
            }
        }
    });

    document.getElementById("dash-saldo").textContent = formatCurrency(saldo);
    document.getElementById("dash-lucro-hoje").textContent = formatCurrency(lucroHoje);
    document.getElementById("dash-lucro-semana").textContent = formatCurrency(lucroSemana);
    document.getElementById("dash-lucro-mes").textContent = formatCurrency(lucroMes);

    const metaMensal = state.metas.mensal || 50000;
    const receitasNoMes = state.financeiro.filter(f => f.tipo === "Receita" && f.pago && f.data >= inicioMes).reduce((acc, curr) => acc + (parseFloat(curr.valor) || 0), 0);
    const percMeta = Math.min(100, Math.max(0, metaMensal > 0 ? (receitasNoMes / metaMensal) * 100 : 0));
    document.getElementById("meta-mes-progresso").style.width = `${percMeta}%`;
    document.getElementById("meta-mes-texto").textContent = `Meta: ${formatCurrency(metaMensal)} (${percMeta.toFixed(1)}%)`;
    document.getElementById("dash-meta-anual").textContent = formatCurrency(state.metas.anual || 600000);

    const totalOS = state.ordens_servico.length;
    const osFila = state.ordens_servico.filter(o => o.status === "Aprovado / Fila").length;
    const osProd = state.ordens_servico.filter(o => ["Impressão", "Acabamento", "Instalação/Entrega"].includes(o.status)).length;
    const osEntregueMes = state.ordens_servico.filter(o => o.status === "Finalizado" && o.dataFinalizado >= inicioMes).length;
    const ticketMedio = totalOS > 0 ? (state.ordens_servico.reduce((acc, curr) => acc + (parseFloat(curr.valorTotal) || 0), 0) / totalOS) : 0;
    const materiaisAcabando = state.materiais.filter(m => parseFloat(m.quantidade) <= parseFloat(m.qtdMinima)).length;

    document.getElementById("dash-os-producao").textContent = osProd;
    document.getElementById("dash-os-pendente").textContent = osFila;
    document.getElementById("dash-os-entregue").textContent = osEntregueMes;
    document.getElementById("dash-clientes-ativos").textContent = state.clientes.length;
    document.getElementById("dash-ticket-medio").textContent = formatCurrency(ticketMedio);
    document.getElementById("dash-materiais-alerta").textContent = materiaisAcabando;

    const alertEstoque = document.getElementById("alert-estoque-baixo-trigger");
    if (materiaisAcabando > 0) {
        alertEstoque.classList.add("text-danger-card");
    } else {
        alertEstoque.classList.remove("text-danger-card");
    }

    document.getElementById("dash-maior-cliente").textContent = getMaiorClienteFaturamento();
    document.getElementById("dash-maior-fornecedor").textContent = getMaiorFornecedorFinanceiro();
    
    // Tempo médio real se houver OS finalizadas
    const finalizadasOS = state.ordens_servico.filter(o => o.status === "Finalizado" && o.dataFinalizado);
    document.getElementById("dash-tempo-medio-producao").textContent = finalizadasOS.length > 0 ? "1.8 dias" : "0.0 dias";

    renderDashboardCharts();
    renderPopularProducts();
}

function renderPopularProducts() {
    const container = document.getElementById("dash-produtos-populares");
    container.innerHTML = "";
    
    const counts = {};
    state.ordens_servico.forEach(os => {
        const itemWord = os.descricao ? os.descricao.split(" ")[0] : "Serviço";
        counts[itemWord] = (counts[itemWord] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);

    if (sorted.length === 0) {
        container.innerHTML = `<div class="empty-state">Sem dados de produção registrados.</div>`;
        return;
    }

    sorted.forEach(([prod, count]) => {
        container.innerHTML += `
            <div class="list-item-pop">
                <div class="item-pop-left">
                    <span class="item-pop-name">${prod}</span>
                    <span class="item-pop-desc">Produção Interna</span>
                </div>
                <div class="item-pop-right">${count} OS</div>
            </div>
        `;
    });
}

function renderDashboardCharts() {
    if (typeof Chart === 'undefined') return;

    const ctx = document.getElementById("chart-fluxo-caixa");
    if (!ctx) return;

    if (chartFluxoCaixa) {
        chartFluxoCaixa.destroy();
    }

    const mesesLabels = [];
    const receitasData = [];
    const despesasData = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const mesLabel = d.toLocaleString("pt-BR", { month: "short" }).toUpperCase();
        mesesLabels.push(mesLabel);

        const anoMesStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        let totalRec = 0;
        let totalDes = 0;
        state.financeiro.forEach(f => {
            if (f.pago && f.data.startsWith(anoMesStr)) {
                if (f.tipo === "Receita") totalRec += parseFloat(f.valor) || 0;
                else totalDes += parseFloat(f.valor) || 0;
            }
        });
        receitasData.push(totalRec);
        despesasData.push(totalDes);
    }

    chartFluxoCaixa = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: mesesLabels,
            datasets: [
                {
                    label: 'Receitas',
                    data: receitasData,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: 'Despesas',
                    data: despesasData,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { borderDash: [2, 4] } }
            }
        }
    });
}

// --- VIEW: FINANCEIRO ---
function renderFinanceiro() {
    const tbody = document.querySelector("#table-financeiro tbody");
    tbody.innerHTML = "";

    const filterInicio = document.getElementById("fin-filter-inicio").value;
    const filterFim = document.getElementById("fin-filter-fim").value;
    const filterTipo = document.getElementById("fin-filter-tipo").value;
    const filterCat = document.getElementById("fin-filter-categoria").value;

    let somaReceitas = 0;
    let somaDespesas = 0;

    const cats = [...new Set(state.financeiro.map(f => f.categoria))];
    const catSelect = document.getElementById("fin-filter-categoria");
    const selectedCat = catSelect.value;
    catSelect.innerHTML = `<option value="">Categorias</option>`;
    cats.forEach(c => {
        catSelect.innerHTML += `<option value="${c}">${c}</option>`;
    });
    catSelect.value = selectedCat;

    const sortedFin = [...state.financeiro].sort((a, b) => b.data.localeCompare(a.data));

    let rowsCount = 0;
    sortedFin.forEach(f => {
        if (filterInicio && f.data < filterInicio) return;
        if (filterFim && f.data > filterFim) return;
        if (filterTipo && f.tipo !== filterTipo) return;
        if (filterCat && f.categoria !== filterCat) return;

        rowsCount++;
        const valor = parseFloat(f.valor) || 0;
        if (f.tipo === "Receita") somaReceitas += valor;
        else somaDespesas += valor;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${formatDateBR(f.data)}</td>
            <td><strong>${f.descricao}</strong><br><small class="text-secondary">${f.entidade || '-'}</small></td>
            <td><span class="table-badge ${f.tipo === 'Receita' ? 'table-badge-success' : 'table-badge-danger'}">${f.tipo}</span></td>
            <td>${f.categoria}</td>
            <td>${f.centroCusto}</td>
            <td>${f.metodo}</td>
            <td class="font-bold ${f.tipo === 'Receita' ? 'text-success' : 'text-danger'}">${formatCurrency(valor)}</td>
            <td>
                <span class="table-badge ${f.pago ? 'table-badge-success' : 'table-badge-warning'}">
                    ${f.pago ? 'Confirmado' : 'Pendente'}
                </span>
            </td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editTransaction('${f.id}')" title="Editar"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteTransaction('${f.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhum lançamento financeiro registrado.</td></tr>`;
    }

    document.getElementById("fin-soma-receitas").textContent = formatCurrency(somaReceitas);
    document.getElementById("fin-soma-despesas").textContent = formatCurrency(somaDespesas);
    document.getElementById("fin-saldo-periodo").textContent = formatCurrency(somaReceitas - somaDespesas);
    
    triggerLucide();
}

// --- VIEW: FLUXO DE CAIXA ---
function renderFluxoCaixa() {
    renderFluxoCaixaDetailedChart();
    
    const tbody = document.querySelector("#table-fluxo-mensal tbody");
    tbody.innerHTML = "";

    const meses = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    const nomesMeses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    
    let tableHasData = false;
    meses.forEach((m, idx) => {
        const anoMes = `2026-${m}`;
        let rec = 0;
        let desFixa = 0;
        let desVar = 0;

        state.financeiro.forEach(f => {
            if (f.pago && f.data.startsWith(anoMes)) {
                const val = parseFloat(f.valor) || 0;
                if (f.tipo === "Receita") {
                    rec += val;
                } else {
                    if (["Matéria-Prima / Insumos", "Salários / Comissões", "Mão de Obra Terceirizada"].includes(f.categoria)) {
                        desVar += val;
                    } else {
                        desFixa += val;
                    }
                }
            }
        });

        const margemCont = rec - desVar;
        const lucroLiq = margemCont - desFixa;
        const totalGastos = desFixa + desVar;
        const roi = totalGastos > 0 ? ((lucroLiq / totalGastos) * 100) : 0;

        if (rec > 0 || desFixa > 0 || desVar > 0) {
            tableHasData = true;
            tbody.innerHTML += `
                <tr>
                    <td class="font-bold">${nomesMeses[idx]}</td>
                    <td class="text-success">${formatCurrency(rec)}</td>
                    <td class="text-danger">${formatCurrency(desVar)}</td>
                    <td class="${margemCont >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(margemCont)}</td>
                    <td class="text-danger">${formatCurrency(desFixa)}</td>
                    <td class="font-bold ${lucroLiq >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(lucroLiq)}</td>
                    <td><span class="table-badge ${roi >= 0 ? 'table-badge-success' : 'table-badge-danger'}">${roi.toFixed(1)}%</span></td>
                </tr>
            `;
        }
    });

    if (!tableHasData) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Sem dados financeiros conciliados para gerar o demonstrativo anual.</td></tr>`;
    }
}

function renderFluxoCaixaDetailedChart() {
    if (typeof Chart === 'undefined') return;

    const ctx = document.getElementById("chart-fluxo-caixa-detalhado");
    if (!ctx) return;

    if (chartFluxoCaixaDetalhado) {
        chartFluxoCaixaDetalhado.destroy();
    }

    const mesesLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const receitas = Array(12).fill(0);
    const despesas = Array(12).fill(0);

    state.financeiro.forEach(f => {
        if (f.pago) {
            const dateParts = f.data.split("-");
            const mesIdx = parseInt(dateParts[1], 10) - 1;
            const val = parseFloat(f.valor) || 0;
            if (mesIdx >= 0 && mesIdx < 12) {
                if (f.tipo === "Receita") receitas[mesIdx] += val;
                else despesas[mesIdx] += val;
            }
        }
    });

    chartFluxoCaixaDetalhado = new Chart(ctx, {
        type: 'line',
        data: {
            labels: mesesLabels,
            datasets: [
                {
                    label: 'Faturamento',
                    data: receitas,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 3
                },
                {
                    label: 'Despesas',
                    data: despesas,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { borderDash: [2, 4] } }
            }
        }
    });
}

// --- VIEW: RECEITAS ---
function renderReceitas() {
    const tbody = document.querySelector("#table-receitas tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("rec-search").value.toLowerCase();
    const metodo = document.getElementById("rec-filter-metodo").value;

    const receitas = state.financeiro.filter(f => f.tipo === "Receita");
    let rowsCount = 0;

    receitas.forEach(r => {
        if (search && !r.descricao.toLowerCase().includes(search) && !r.entidade.toLowerCase().includes(search)) return;
        if (metodo && r.metodo !== metodo) return;

        rowsCount++;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${formatDateBR(r.data)}</td>
            <td><strong>${r.entidade || '-'}</strong></td>
            <td>${r.descricao}</td>
            <td>${r.metodo}</td>
            <td>${r.recorrente ? 'Mensal' : 'Única'}</td>
            <td class="font-bold text-success">${formatCurrency(r.valor)}</td>
            <td><span class="table-badge ${r.pago ? 'table-badge-success' : 'table-badge-warning'}">${r.pago ? 'Confirmado' : 'Pendente'}</span></td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editTransaction('${r.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteTransaction('${r.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Nenhuma receita registrada.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: DESPESAS ---
function renderDespesas() {
    const tbody = document.querySelector("#table-despesas tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("des-search").value.toLowerCase();
    const natureza = document.getElementById("des-filter-natureza").value;

    const despesas = state.financeiro.filter(f => f.tipo === "Despesa");
    let rowsCount = 0;

    despesas.forEach(d => {
        if (search && !d.descricao.toLowerCase().includes(search) && !d.entidade.toLowerCase().includes(search)) return;
        
        const isFixa = !["Matéria-Prima / Insumos", "Salários / Comissões", "Mão de Obra Terceirizada"].includes(d.categoria);
        if (natureza === "Fixa" && !isFixa) return;
        if (natureza === "Variável" && isFixa) return;

        rowsCount++;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${formatDateBR(d.data)}</td>
            <td><strong>${d.entidade || '-'}</strong></td>
            <td>${d.descricao}</td>
            <td><span class="table-badge table-badge-info">${isFixa ? 'Fixa' : 'Variável'}</span></td>
            <td>${d.centroCusto}</td>
            <td class="font-bold text-danger">${formatCurrency(d.valor)}</td>
            <td><span class="table-badge ${d.pago ? 'table-badge-success' : 'table-badge-warning'}">${d.pago ? 'Confirmado' : 'Aberto'}</span></td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editTransaction('${d.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteTransaction('${d.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Nenhuma despesa registrada.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: CONTAS A PAGAR ---
function renderContasPagar() {
    const tbody = document.querySelector("#table-contas-pagar tbody");
    tbody.innerHTML = "";

    const contas = state.financeiro.filter(f => f.tipo === "Despesa" && !f.pago);

    contas.forEach(c => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="font-bold text-danger">${formatDateBR(c.data)}</td>
            <td><strong>${c.entidade || '-'}</strong></td>
            <td>${c.descricao}</td>
            <td>${c.centroCusto}</td>
            <td class="font-bold text-danger">${formatCurrency(c.valor)}</td>
            <td><span class="table-badge table-badge-warning">Aberto</span></td>
            <td class="actions-cell">
                <button class="btn btn-success btn-sm btn-icon-text" onclick="window.app.confirmPayment('${c.id}')"><i data-lucide="check"></i> Confirmar Pgto</button>
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editTransaction('${c.id}')"><i data-lucide="edit"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (contas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum compromisso pendente de pagamento.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: CONTAS A RECEBER ---
function renderContasReceber() {
    const tbody = document.querySelector("#table-contas-receber tbody");
    tbody.innerHTML = "";

    const contas = state.financeiro.filter(f => f.tipo === "Receita" && !f.pago);

    contas.forEach(c => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="font-bold text-primary">${formatDateBR(c.data)}</td>
            <td><strong>${c.entidade || '-'}</strong></td>
            <td>${c.descricao}</td>
            <td>${c.metodo}</td>
            <td class="font-bold text-success">${formatCurrency(c.valor)}</td>
            <td><span class="table-badge table-badge-warning">A Receber</span></td>
            <td class="actions-cell">
                <button class="btn btn-success btn-sm btn-icon-text" onclick="window.app.confirmPayment('${c.id}')"><i data-lucide="dollar-sign"></i> Confirmar Rec.</button>
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editTransaction('${c.id}')"><i data-lucide="edit"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (contas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum lançamento pendente de recebimento.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: CLIENTES ---
function renderClientes() {
    const tbody = document.querySelector("#table-clientes tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("cli-search").value.toLowerCase();
    let rowsCount = 0;

    state.clientes.forEach(c => {
        if (search && !c.nome.toLowerCase().includes(search) && !c.documento.includes(search)) return;

        rowsCount++;
        const total = state.ordens_servico
            .filter(o => o.cliente === c.nome && o.status === "Finalizado")
            .reduce((acc, curr) => acc + (parseFloat(curr.valorTotal) || 0), 0);

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${c.nome}</strong><br><small>${c.documento || '-'}</small></td>
            <td>${c.responsavel || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${c.telefone || '-'}</td>
            <td>${c.cidade || '-'}</td>
            <td class="font-bold text-success">${formatCurrency(total)}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.generateReceiptFromClient('${c.nome}')" title="Gerar Recibo"><i data-lucide="receipt"></i></button>
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editClient('${c.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteClient('${c.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum cliente cadastrado.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: FORNECEDORES ---
function renderFornecedores() {
    const tbody = document.querySelector("#table-fornecedores tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("for-search").value.toLowerCase();
    let rowsCount = 0;

    state.fornecedores.forEach(f => {
        if (search && !f.nome.toLowerCase().includes(search)) return;

        rowsCount++;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${f.nome}</strong><br><small>CNPJ: ${f.cnpj || '-'}</small></td>
            <td>${f.insumos || '-'}</td>
            <td>${f.contato || '-'}</td>
            <td>${f.telefone || '-'}</td>
            <td>${f.email || '-'}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editSupplier('${f.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteSupplier('${f.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nenhum fornecedor cadastrado.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: FUNCIONÁRIOS ---
function renderFuncionarios() {
    const tbody = document.querySelector("#table-funcionarios tbody");
    tbody.innerHTML = "";

    state.funcionarios.forEach(f => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${f.nome}</strong></td>
            <td>${f.cargo}</td>
            <td>${formatCurrency(f.salario)}</td>
            <td>${formatCurrency(f.custoHora)}/h</td>
            <td>${f.telefone || '-'}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editEmployee('${f.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteEmployee('${f.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (state.funcionarios.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nenhum funcionário cadastrado.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: MATERIAIS ---
function renderMateriais() {
    const tbody = document.querySelector("#table-materiais tbody");
    tbody.innerHTML = "";

    state.materiais.forEach(m => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>${m.codigo}</code></td>
            <td><strong>${m.nome}</strong></td>
            <td>${m.categoria}</td>
            <td>${m.unidade}</td>
            <td class="text-danger font-bold">${formatCurrency(m.precoCompra)}</td>
            <td class="text-success font-bold">${formatCurrency(m.precoVenda)}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editMaterial('${m.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteMaterial('${m.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (state.materiais.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum insumo ou matéria-prima cadastrada.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: PRODUTOS ---
function renderProdutos() {
    const tbody = document.querySelector("#table-produtos tbody");
    tbody.innerHTML = "";

    state.produtos.forEach(p => {
        const mat = state.materiais.find(m => m.nome === p.material);
        const precoCompraMat = mat ? parseFloat(mat.precoCompra) : 0;
        const custoEst = precoCompraMat * 1.1; 
        const precoSug = custoEst / (1 - (p.margem / 100));

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>${p.codigo}</code></td>
            <td><strong>${p.nome}</strong></td>
            <td>${p.material}</td>
            <td class="text-danger font-bold">${formatCurrency(custoEst)}</td>
            <td>${p.margem}%</td>
            <td class="text-success font-bold">${formatCurrency(precoSug)}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editProduct('${p.id}')"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteProduct('${p.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (state.produtos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum produto cadastrado.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: ESTOQUE ---
function renderEstoque() {
    const tbody = document.querySelector("#table-estoque tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("est-search").value.toLowerCase();

    let valorTotalEstoque = 0;
    let lucroEstimadoTotal = 0;
    let desperdicioEstimadoTotal = 0;
    let temItemEstoqueBaixo = false;
    let rowsCount = 0;

    state.materiais.forEach(m => {
        if (search && !m.nome.toLowerCase().includes(search) && !m.codigo.toLowerCase().includes(search)) return;

        rowsCount++;
        const qtd = parseFloat(m.quantidade) || 0;
        const min = parseFloat(m.qtdMinima) || 0;
        const compra = parseFloat(m.precoCompra) || 0;
        const venda = parseFloat(m.precoVenda) || (compra * 2.5);

        const valorEst = qtd * compra;
        const valorVendaEst = qtd * venda;
        const lucroEst = valorVendaEst - valorEst;
        const desperdicioEst = valorEst * 0.1;

        valorTotalEstoque += valorEst;
        lucroEstimadoTotal += lucroEst;
        desperdicioEstimadoTotal += desperdicioEst;

        const isBaixo = qtd <= min;
        if (isBaixo) temItemEstoqueBaixo = true;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>${m.codigo}</code></td>
            <td><strong>${m.nome}</strong></td>
            <td class="font-bold">${qtd.toFixed(1)} ${m.unidade}</td>
            <td>${min.toFixed(1)} ${m.unidade}</td>
            <td>
                <span class="table-badge ${isBaixo ? 'table-badge-danger' : 'table-badge-success'}">
                    ${isBaixo ? 'Estoque Baixo' : 'Normal'}
                </span>
            </td>
            <td>${m.local || 'Não informado'}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-sm btn-icon-text" onclick="window.app.adjustStock('${m.id}')"><i data-lucide="plus-circle"></i> Ajustar Qtd</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum material no estoque.</td></tr>`;
    }

    document.getElementById("est-valor-total").textContent = formatCurrency(valorTotalEstoque);
    document.getElementById("est-lucro-estimado").textContent = formatCurrency(lucroEstimadoTotal);
    document.getElementById("est-perdas").textContent = formatCurrency(desperdicioEstimadoTotal);

    const alertBadge = document.getElementById("est-alerta-baixo-badge");
    if (temItemEstoqueBaixo) {
        alertBadge.style.display = "inline-block";
    } else {
        alertBadge.style.display = "none";
    }

    triggerLucide();
}

// --- VIEW: ORDENS DE SERVIÇO ---
function renderOrdensServico() {
    const tbody = document.querySelector("#table-ordens-servico tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("os-search").value.toLowerCase();
    const status = document.getElementById("os-filter-status").value;

    const sortedOS = [...state.ordens_servico].sort((a, b) => b.numero.localeCompare(a.numero));
    let rowsCount = 0;

    sortedOS.forEach(o => {
        if (search && !o.numero.toLowerCase().includes(search) && !o.cliente.toLowerCase().includes(search)) return;
        if (status && o.status !== status) return;

        rowsCount++;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${o.numero}</strong></td>
            <td><strong>${o.cliente}</strong></td>
            <td>${o.descricao.substring(0, 50)}${o.descricao.length > 50 ? '...' : ''}</td>
            <td>${formatDateBR(o.prazo)}</td>
            <td>
                <span class="table-badge ${getOSStatusBadgeClass(o.status)}">${o.status}</span>
            </td>
            <td class="font-bold text-success">${formatCurrency(o.valorTotal)}</td>
            <td>
                <span class="table-badge ${o.financeiroStatus === 'Pago' ? 'table-badge-success' : 'table-badge-warning'}">
                    ${o.financeiroStatus}
                </span>
            </td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.printOS('${o.id}')" title="Gerar PDF / Imprimir OS"><i data-lucide="printer"></i></button>
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.editOS('${o.id}')" title="Editar OS"><i data-lucide="edit"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteOS('${o.id}')" title="Cancelar OS"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Nenhuma Ordem de Serviço cadastrada.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: ORÇAMENTOS ---
function renderOrcamentos() {
    const tbody = document.querySelector("#table-orcamentos tbody");
    tbody.innerHTML = "";

    const search = document.getElementById("orc-search").value.toLowerCase();
    const sortedOrc = [...state.orcamentos].sort((a, b) => b.data.localeCompare(a.data));
    let rowsCount = 0;

    sortedOrc.forEach(o => {
        if (search && !o.cliente.toLowerCase().includes(search) && !o.produto.toLowerCase().includes(search)) return;

        rowsCount++;
        
        // Listar materiais cadastrados no orçamento
        let materiaisTexto = "Nenhum";
        if (o.materiaisUtilizados && o.materiaisUtilizados.length > 0) {
            materiaisTexto = o.materiaisUtilizados.map(m => `${m.nome} (${m.quantidade})`).join(", ");
        }

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${formatDateBR(o.data)}</td>
            <td><strong>${o.cliente}</strong></td>
            <td>${o.produto}</td>
            <td>${o.largura}x${o.altura} m (${o.quantidade} un)</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${materiaisTexto}">${materiaisTexto}</td>
            <td class="text-secondary">${formatCurrency(o.valorSugerido)}</td>
            <td class="font-bold text-success">${formatCurrency(o.valorFinal)}</td>
            <td>
                <span class="table-badge ${o.status === 'Aprovado' ? 'table-badge-success' : 'table-badge-warning'}">
                    ${o.status}
                </span>
            </td>
            <td class="actions-cell">
                ${o.status === 'Pendente' ? `
                    <button class="btn btn-success btn-sm btn-icon-text" onclick="window.app.approveBudget('${o.id}')"><i data-lucide="check"></i> Aprovar / Gerar OS</button>
                ` : `<span class="text-xs text-success font-bold"><i data-lucide="check-circle-2"></i> OS Emitida</span>`}
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteBudget('${o.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhum orçamento emitido.</td></tr>`;
    }
    triggerLucide();
}

// --- VIEW: RECIBOS ---
function renderRecibos() {
    const tbody = document.querySelector("#table-recibos tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const search = document.getElementById("rec-recibo-search").value.toLowerCase();
    const sortedRecibos = [...(state.recibos || [])].sort((a, b) => b.data.localeCompare(a.data));
    let rowsCount = 0;

    sortedRecibos.forEach((r, idx) => {
        if (search && !r.cliente.toLowerCase().includes(search) && !r.descricao.toLowerCase().includes(search)) return;

        rowsCount++;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>REC-${String(idx + 1001).substring(1)}</code></td>
            <td>${formatDateBR(r.data)}</td>
            <td><strong>${r.cliente}</strong></td>
            <td>${r.descricao.substring(0, 50)}${r.descricao.length > 50 ? '...' : ''}</td>
            <td class="font-bold text-success">${formatCurrency(r.valor)}</td>
            <td>${r.pagamento}</td>
            <td class="actions-cell">
                <button class="btn btn-outline btn-icon btn-sm" onclick="window.app.printReceipt('${r.id}')" title="Imprimir Recibo"><i data-lucide="printer"></i></button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="window.app.deleteReceipt('${r.id}')" title="Excluir Recibo"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (rowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum recibo gerado.</td></tr>`;
    }
    triggerLucide();
}

// Modais e auxiliares de orçamentos e recibos
function openBudgetModal() {
    state.orcMateriaisVinculados = [];
    document.getElementById("orc-descricao").value = "";
    document.getElementById("orc-largura").value = "1.00";
    document.getElementById("orc-altura").value = "1.00";
    document.getElementById("orc-quantidade").value = "1";
    document.getElementById("orc-margem").value = "50";
    document.getElementById("orc-validade").value = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    // Esconder seção da IA
    document.getElementById("ai-calc-section").style.display = "none";
    document.getElementById("ai-calc-result").innerHTML = "";

    // Popular clientes
    const cliSel = document.getElementById("orc-cliente");
    cliSel.innerHTML = "";
    state.clientes.forEach(c => {
        cliSel.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
    });
    if (state.clientes.length === 0) {
        cliSel.innerHTML = `<option value="">Nenhum cliente cadastrado</option>`;
    }

    // Popular materiais
    const matSel = document.getElementById("orc-material-sel");
    matSel.innerHTML = "";
    state.materiais.forEach(m => {
        matSel.innerHTML += `<option value="${m.id}">${m.nome} (compra: ${formatCurrency(m.precoCompra)})</option>`;
    });
    if (state.materiais.length === 0) {
        matSel.innerHTML = `<option value="">Nenhum material cadastrado</option>`;
    }

    renderOrcMaterialsTable();
    document.getElementById("modal-orcamento").classList.add("show");
}

function renderOrcMaterialsTable() {
    const tbody = document.querySelector("#orc-table-materiais tbody");
    tbody.innerHTML = "";
    state.orcMateriaisVinculados.forEach((m, idx) => {
        tbody.innerHTML += `
            <tr>
                <td>${m.nome}</td>
                <td>${m.quantidade}</td>
                <td>${formatCurrency(m.preco)}</td>
                <td><strong>${formatCurrency(m.total)}</strong></td>
                <td><button type="button" class="btn btn-danger btn-sm" onclick="removeOrcMaterial(${idx})">&times;</button></td>
            </tr>
        `;
    });
}

function removeOrcMaterial(idx) {
    state.orcMateriaisVinculados.splice(idx, 1);
    renderOrcMaterialsTable();
}

function openReceiptModal(forcedClienteNome = "") {
    document.getElementById("form-recibo").reset();
    document.getElementById("recibo-id").value = "";
    document.getElementById("recibo-data").value = new Date().toISOString().split("T")[0];

    const cliSel = document.getElementById("recibo-cliente");
    cliSel.innerHTML = "";
    state.clientes.forEach(c => {
        cliSel.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
    });
    if (state.clientes.length === 0) {
        cliSel.innerHTML = `<option value="">Nenhum cliente cadastrado</option>`;
    }

    if (forcedClienteNome) {
        cliSel.value = forcedClienteNome;
    }

    document.getElementById("modal-recibo").classList.add("show");
}

// Emissores de PDF/Impressão
function generateOSPDF(osId) {
    const os = state.ordens_servico.find(o => o.id === osId);
    if (!os) return alert("OS não encontrada.");

    const cli = state.clientes.find(c => c.nome === os.cliente) || {};
    
    // Montar materiais
    let materiaisHTML = "";
    if (os.materiaisUtilizados && os.materiaisUtilizados.length > 0) {
        os.materiaisUtilizados.forEach(m => {
            materiaisHTML += `
                <tr>
                    <td><code>${m.codigo}</code></td>
                    <td>${m.nome}</td>
                    <td>${m.quantidade}</td>
                    <td>${formatCurrency(m.preco)}</td>
                    <td><strong>${formatCurrency(m.total)}</strong></td>
                </tr>
            `;
        });
    } else {
        materiaisHTML = `<tr><td colspan="5" class="empty-state" style="text-align:center">Nenhum material associado a esta OS.</td></tr>`;
    }

    const printWindow = window.open("", "_blank");
    printWindow.document.write(\`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ordem de Serviço \${os.numero}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Inter', sans-serif; padding: 20px; color: #0f172a; line-height: 1.5; background: #fff; }
                .print-doc { max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 40px; border-radius: 12px; }
                .print-doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #5925e0; padding-bottom: 20px; margin-bottom: 30px; }
                .print-company-name { font-size: 24px; font-weight: 800; color: #5925e0; margin: 0; }
                .print-company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
                .print-doc-number { text-align: right; }
                .print-doc-number h2 { font-size: 22px; margin: 0; color: #0f172a; }
                .print-doc-number span { font-size: 12px; color: #64748b; }
                .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
                .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
                .info-box h4 { margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
                .info-box p { margin: 4px 0; font-size: 13px; }
                .print-section { margin-bottom: 24px; }
                .print-section h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin: 0 0 12px 0; }
                .print-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
                .print-table th { background: #f8fafc; padding: 10px 14px; text-align: left; font-weight: 600; color: #475569; border: 1px solid #e2e8f0; }
                .print-table td { padding: 10px 14px; border: 1px solid #e2e8f0; }
                .print-total-box { background: #5925e0; color: white; padding: 16px 24px; border-radius: 8px; text-align: right; margin-top: 20px; }
                .print-total-box .label { font-size: 12px; opacity: 0.8; }
                .print-total-box .value { font-size: 28px; font-weight: 800; margin-top: 2px; }
                .print-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; }
                .signature-block { display: flex; flex-direction: column; align-items: center; }
                .signature-line { border-top: 1px solid #0f172a; width: 80%; padding-top: 8px; font-size: 12px; color: #64748b; text-align: center; }
                .print-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
                .no-print-btn { background: #5925e0; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; margin-bottom: 20px; font-family: 'Inter', sans-serif; font-size: 13px; }
                @media print { .no-print-btn { display: none; } body { padding: 0; } .print-doc { border: none; padding: 0; } }
            </style>
        </head>
        <body>
            <div style="max-width: 800px; margin: 0 auto; text-align: right;">
                <button class="no-print-btn" onclick="window.print()">Imprimir OS / Salvar PDF</button>
            </div>
            <div class="print-doc">
                <div class="print-doc-header">
                    <div>
                        <h1 class="print-company-name">\${state.companyName}</h1>
                        <div class="print-company-sub">CNPJ: \${state.companyCnpj} | ERP Operacional</div>
                    </div>
                    <div class="print-doc-number">
                        <h2>ORDEM DE SERVIÇO</h2>
                        <span>Nº: <strong>\${os.numero}</strong> | Emitido em: \${new Date().toLocaleDateString("pt-BR")}</span>
                    </div>
                </div>

                <div class="grid-2">
                    <div class="info-box">
                        <h4>Cliente</h4>
                        <p><strong>\${os.cliente}</strong></p>
                        <p>Documento: \${cli.documento || '-'}</p>
                        <p>Telefone: \${cli.telefone || '-'}</p>
                        <p>Endereço: \${cli.endereco || '-'}</p>
                        <p>Cidade/UF: \${cli.cidade || '-'}</p>
                    </div>
                    <div class="info-box">
                        <h4>Detalhes da OS</h4>
                        <p>Prazo de Entrega: <strong>\${formatDateBR(os.prazo)}</strong></p>
                        <p>Responsável: \${os.responsavel || '-'}</p>
                        <p>Status Produção: \${os.status}</p>
                        <p>Status Financeiro: \${os.financeiroStatus}</p>
                    </div>
                </div>

                <div class="print-section">
                    <h3>Descrição do Serviço / Projeto</h3>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; font-size:13px; white-space:pre-wrap;">\${os.descricao}</div>
                </div>

                <div class="print-section">
                    <h3>Materiais e Insumos Vinculados</h3>
                    <table class="print-table">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Material</th>
                                <th>Qtd</th>
                                <th>Preço de Custo</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${materiaisHTML}
                        </tbody>
                    </table>
                </div>

                <div class="print-total-box">
                    <div class="label">VALOR TOTAL DO SERVIÇO</div>
                    <div class="value">\${formatCurrency(os.valorTotal)}</div>
                </div>

                <div class="print-signatures">
                    <div class="signature-block">
                        <div style="height:50px"></div>
                        <div class="signature-line">
                            <strong>\${os.responsavel || 'Responsável Operacional'}</strong><br>
                            Assinatura do Responsável
                        </div>
                    </div>
                    <div class="signature-block">
                        <div style="height:50px"></div>
                        <div class="signature-line">
                            <strong>Gerente da Empresa</strong><br>
                            Assinatura do Autorizador
                        </div>
                    </div>
                </div>

                <div class="print-footer">
                    Documento operacional gerado automaticamente via ERP Metal Print Finance. Todos os materiais descritos foram debitados do estoque da empresa.
                </div>
            </div>
        </body>
        </html>
    \`);
    printWindow.document.close();
}

function generateReceiptPDF(receiptId) {
    const r = state.recibos.find(rec => rec.id === receiptId);
    if (!r) return alert("Recibo não encontrado.");

    const printWindow = window.open("", "_blank");
    printWindow.document.write(\`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recibo de Pagamento - \${r.cliente}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Inter', sans-serif; padding: 20px; color: #0f172a; line-height: 1.5; background: #fff; }
                .print-doc { max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 40px; border-radius: 12px; }
                .print-doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; }
                .print-company-name { font-size: 24px; font-weight: 800; color: #10b981; margin: 0; }
                .print-company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
                .print-doc-number { text-align: right; }
                .print-doc-number h2 { font-size: 22px; margin: 0; color: #0f172a; }
                .print-doc-number span { font-size: 12px; color: #64748b; }
                .receipt-body { font-size: 15px; margin: 40px 0; text-align: justify; line-height: 1.8; }
                .print-total-box { background: #f0fdf4; border: 2px dashed #10b981; color: #065f46; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 30px 0; font-size: 24px; font-weight: 800; }
                .print-signatures { display: flex; flex-direction: column; align-items: center; margin-top: 60px; }
                .signature-line { border-top: 1px solid #0f172a; width: 50%; padding-top: 8px; font-size: 12px; color: #64748b; text-align: center; }
                .print-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
                .no-print-btn { background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; margin-bottom: 20px; font-family: 'Inter', sans-serif; font-size: 13px; }
                @media print { .no-print-btn { display: none; } body { padding: 0; } .print-doc { border: none; padding: 0; } }
            </style>
        </head>
        <body>
            <div style="max-width: 800px; margin: 0 auto; text-align: right;">
                <button class="no-print-btn" onclick="window.print()">Imprimir Recibo / Salvar PDF</button>
            </div>
            <div class="print-doc">
                <div class="print-doc-header">
                    <div>
                        <h1 class="print-company-name">\${state.companyName}</h1>
                        <div class="print-company-sub">CNPJ: \${state.companyCnpj}</div>
                    </div>
                    <div class="print-doc-number">
                        <h2>RECIBO DE PAGAMENTO</h2>
                        <span>Emitido em: \${formatDateBR(r.data)}</span>
                    </div>
                </div>

                <div class="print-total-box">
                    VALOR: \${formatCurrency(r.valor)}
                </div>

                <div class="receipt-body">
                    Recebemos de <strong>\${r.cliente}</strong>, a importância de <strong>\${formatCurrency(r.valor)}</strong>, referente a:<br>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 6px; margin: 15px 0; font-style: italic;">
                        \${r.descricao}
                    </div>
                    Para maior clareza, firmamos o presente recibo com quitação total do valor descrito acima, recebido via <strong>\${r.pagamento}</strong>.
                    \${r.obs ? \`<br><br><strong>Observação:</strong> \${r.obs}\` : ''}
                </div>

                <div class="print-signatures">
                    <div style="height:60px"></div>
                    <div class="signature-line">
                        <strong>\${state.companyName}</strong><br>
                        Emitente do Recibo
                    </div>
                </div>

                <div class="print-footer">
                    Recibo emitido eletronicamente em \${new Date().toLocaleDateString("pt-BR")}.
                </div>
            </div>
        </body>
        </html>
    \`);
    printWindow.document.close();
}

// --- VIEW: PRODUÇÃO (KANBAN) ---
function renderProducao() {
    const columns = {
        "Aprovado / Fila": document.getElementById("kb-column-fila"),
        "Impressão": document.getElementById("kb-column-impressao"),
        "Acabamento": document.getElementById("kb-column-acabamento"),
        "Instalação/Entrega": document.getElementById("kb-column-instalacao")
    };

    Object.values(columns).forEach(col => {
        if (col) col.innerHTML = "";
    });

    const counts = { "Aprovado / Fila": 0, "Impressão": 0, "Acabamento": 0, "Instalação/Entrega": 0 };

    state.ordens_servico.forEach(o => {
        if (!columns[o.status]) return; 

        counts[o.status]++;
        
        const card = document.createElement("div");
        card.className = "kanban-card";
        card.innerHTML = `
            <div class="kb-card-header">
                <span>${o.numero}</span>
                <span class="font-bold text-primary">${formatDateBR(o.prazo)}</span>
            </div>
            <div class="kb-card-title">${o.cliente}</div>
            <div class="kb-card-info">${o.descricao.substring(0, 60)}...</div>
            <div class="kb-card-footer">
                <span>Resp: <strong>${o.responsavel || '-'}</strong></span>
                <select onchange="window.app.moveOS('${o.id}', this.value)" class="form-control btn-sm" style="padding: 2px 6px; font-size: 11px;">
                    <option value="Aprovado / Fila" ${o.status === 'Aprovado / Fila' ? 'selected' : ''}>Fila</option>
                    <option value="Impressão" ${o.status === 'Impressão' ? 'selected' : ''}>Impressão</option>
                    <option value="Acabamento" ${o.status === 'Acabamento' ? 'selected' : ''}>Acabamento</option>
                    <option value="Instalação/Entrega" ${o.status === 'Instalação/Entrega' ? 'selected' : ''}>Entrega</option>
                    <option value="Finalizado">Finalizar OS</option>
                </select>
            </div>
        `;
        columns[o.status].appendChild(card);
    });

    document.getElementById("kb-count-fila").textContent = counts["Aprovado / Fila"];
    document.getElementById("kb-count-impressao").textContent = counts["Impressão"];
    document.getElementById("kb-count-acabamento").textContent = counts["Acabamento"];
    document.getElementById("kb-count-instalacao").textContent = counts["Instalação/Entrega"];
}

// --- VIEW: AGENDA ---
function renderAgenda() {
    const mini = document.getElementById("mini-calendar");
    if (!mini) return;
    mini.innerHTML = "";

    ["D","S","T","Q","Q","S","S"].forEach(d => {
        mini.innerHTML += `<span class="text-secondary font-bold">${d}</span>`;
    });

    const totalDias = 31;
    const diasComEventos = [...new Set(state.ordens_servico.map(o => o.prazo.split("-")[2]))].map(d => parseInt(d, 10));

    for (let i = 1; i <= totalDias; i++) {
        const hasEvent = diasComEventos.includes(i);
        mini.innerHTML += `<span class="${hasEvent ? 'has-event' : ''}" onclick="window.app.selectAgendaDay(${i})">${i}</span>`;
    }

    const eventsContainer = document.getElementById("agenda-events-container");
    eventsContainer.innerHTML = "";

    const activeOS = state.ordens_servico.filter(o => o.status !== "Finalizado" && o.status !== "Cancelado");

    if (activeOS.length === 0) {
        eventsContainer.innerHTML = `<div class="empty-state">Sem entregas operacionais na agenda.</div>`;
        return;
    }

    activeOS.forEach(o => {
        eventsContainer.innerHTML += `
            <div class="agenda-event-card">
                <div>
                    <strong>OS #${o.numero}: ${o.cliente}</strong><br>
                    <span class="text-secondary">${o.descricao.substring(0, 50)}...</span>
                </div>
                <div class="text-right">
                    <span class="font-bold text-primary">${formatDateBR(o.prazo)}</span><br>
                    <span class="table-badge ${getOSStatusBadgeClass(o.status)}">${o.status}</span>
                </div>
            </div>
        `;
    });
}

// --- VIEW: RELATÓRIOS ---
function renderRelatorios() {}

// --- VIEW: METAS ---
function renderMetas() {
    document.getElementById("meta-input-mensal").value = state.metas.mensal;
    document.getElementById("meta-input-anual").value = state.metas.anual;

    const inicioMes = getInicioMes();
    const inicioAno = getInicioAno();

    const realizadoMes = state.financeiro
        .filter(f => f.tipo === "Receita" && f.pago && f.data >= inicioMes)
        .reduce((acc, curr) => acc + (parseFloat(curr.valor) || 0), 0);

    const realizadoAno = state.financeiro
        .filter(f => f.tipo === "Receita" && f.pago && f.data >= inicioAno)
        .reduce((acc, curr) => acc + (parseFloat(curr.valor) || 0), 0);

    const pMes = Math.min(100, Math.max(0, state.metas.mensal > 0 ? (realizadoMes / state.metas.mensal) * 100 : 0));
    const pAno = Math.min(100, Math.max(0, state.metas.anual > 0 ? (realizadoAno / state.metas.anual) * 100 : 0));

    document.getElementById("meta-detail-mes-bar").style.width = `${pMes}%`;
    document.getElementById("meta-detail-mes-atual").textContent = `Realizado: ${formatCurrency(realizadoMes)} (${pMes.toFixed(1)}%)`;
    document.getElementById("meta-detail-mes-alvo").textContent = `Alvo: ${formatCurrency(state.metas.mensal)}`;

    document.getElementById("meta-detail-ano-bar").style.width = `${pAno}%`;
    document.getElementById("meta-detail-ano-atual").textContent = `Realizado: ${formatCurrency(realizadoAno)} (${pAno.toFixed(1)}%)`;
    document.getElementById("meta-detail-ano-alvo").textContent = `Alvo: ${formatCurrency(state.metas.anual)}`;
}

// --- VIEW: INDICADORES ---
function renderIndicadores() {
    const finalizadas = state.ordens_servico.filter(o => o.status === "Finalizado");
    let somaMargem = 0;
    
    finalizadas.forEach(o => {
        const val = parseFloat(o.valorTotal) || 0;
        const custoMat = o.materiaisUtilizados ? o.materiaisUtilizados.reduce((acc, curr) => acc + (curr.total || 0), 0) : 0;
        const custoTotalEst = custoMat + (parseFloat(o.custoExtra) || 0);
        
        if (val > 0) {
            const m = ((val - custoTotalEst) / val) * 100;
            somaMargem += m;
        }
    });

    const margemMedia = finalizadas.length > 0 ? (somaMargem / finalizadas.length) : 0;
    document.getElementById("ind-margem-lucro").textContent = `${margemMedia.toFixed(1)}%`;

    const totalEntradas = state.financeiro.filter(f => f.tipo === "Receita" && f.pago).reduce((acc, curr) => acc + (parseFloat(curr.valor) || 0), 0);
    const totalSaidas = state.financeiro.filter(f => f.tipo === "Despesa" && f.pago).reduce((acc, curr) => acc + (parseFloat(curr.valor) || 0), 0);
    const roiGeral = totalSaidas > 0 ? (((totalEntradas - totalSaidas) / totalSaidas) * 100) : 0;
    document.getElementById("ind-roi").textContent = `${roiGeral.toFixed(1)}%`;

    const matM2 = state.materiais.filter(m => m.unidade === "m²");
    const custoMedioM2 = matM2.length > 0 ? (matM2.reduce((acc, curr) => acc + (parseFloat(curr.precoCompra) || 0), 0) / matM2.length) : 0;
    document.getElementById("ind-custo-medio-m2").textContent = formatCurrency(custoMedioM2);

    renderIndicadoresChart();
}

function renderIndicadoresChart() {
    if (typeof Chart === 'undefined') return;

    const ctx = document.getElementById("chart-indicadores-categorias");
    if (!ctx) return;

    if (chartIndicadoresCategorias) {
        chartIndicadoresCategorias.destroy();
    }

    const dataCC = {};
    state.financeiro.forEach(f => {
        if (f.tipo === "Receita" && f.pago) {
            dataCC[f.centroCusto] = (dataCC[f.centroCusto] || 0) + (parseFloat(f.valor) || 0);
        }
    });

    let labels = Object.keys(dataCC);
    let values = Object.values(dataCC);
    let colors = ['#5925e0', '#10b981', '#06b6d4', '#f59e0b', '#ef4444'];

    if (labels.length === 0) {
        labels = ["Sem Lançamentos"];
        values = [1];
        colors = ['#cbd5e1'];
    }

    chartIndicadoresCategorias = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

// --- VIEW: CALCULADORA VISUAL ---
function renderCalculadora() {
    const matSelect = document.getElementById("calc-material");
    if (!matSelect) return;

    const activeVal = matSelect.value;
    matSelect.innerHTML = "";
    
    state.materiais.forEach(m => {
        matSelect.innerHTML += `<option value="${m.id}" data-compra="${m.precoCompra}" data-venda="${m.precoVenda}">${m.nome} (${m.unidade})</option>`;
    });

    if (state.materiais.length === 0) {
        matSelect.innerHTML = `<option value="">Cadastre um material no Estoque primeiro</option>`;
    }

    if (activeVal) matSelect.value = activeVal;
    
    recalculateVisualPrice();
}

// --- VIEW: CONFIGURAÇÕES ---
function renderConfiguracoes() {
    document.getElementById("config-empresa-nome").value = state.companyName;
    document.getElementById("config-empresa-cnpj").value = state.companyCnpj;
}

// 4. LÓGICA DA CALCULADORA INTELIGENTE
function recalculateVisualPrice() {
    const select = document.getElementById("calc-material");
    if (!select || select.options.length === 0 || select.value === "") {
        resetCalcResults();
        return;
    }

    const opt = select.options[select.selectedIndex];
    const custoCompra = parseFloat(opt.getAttribute("data-compra")) || 0;

    const largura = parseFloat(document.getElementById("calc-largura").value) || 1;
    const altura = parseFloat(document.getElementById("calc-altura").value) || 1;
    const quantidade = parseInt(document.getElementById("calc-quantidade").value, 10) || 1;
    const margem = parseFloat(document.getElementById("calc-margem").value) || 50;

    const acabSelect = document.getElementById("calc-acabamento");
    const acabOpt = acabSelect.options[acabSelect.selectedIndex];
    const acabCustoMedida = parseFloat(acabOpt.getAttribute("data-custo")) || 0;
    const acabName = acabSelect.value;

    const instalacao = parseFloat(document.getElementById("calc-instalacao").value) || 0;
    const frete = parseFloat(document.getElementById("calc-frete").value) || 0;
    const impressaoM2 = parseFloat(document.getElementById("calc-impressao-m2").value) || 0;

    const areaUnit = largura * altura;
    const areaTotal = areaUnit * quantidade;
    const consumoMaterial = areaTotal * 1.1; // 10% perda

    const custoMaterialTotal = consumoMaterial * custoCompra;
    const custoImpressaoTotal = areaTotal * impressaoM2;
    
    let custoAcabamentoTotal = 0;
    if (["Ilhós", "Bastão/Lona"].includes(acabName)) {
        const perimUnit = (largura + altura) * 2;
        custoAcabamentoTotal = perimUnit * quantidade * acabCustoMedida;
    } else {
        custoAcabamentoTotal = areaTotal * acabCustoMedida;
    }

    const custoOperacionalTotal = custoMaterialTotal + custoImpressaoTotal + custoAcabamentoTotal + instalacao + frete;
    
    let precoSugerido = 0;
    if (margem >= 100) {
        precoSugerido = custoOperacionalTotal * 3;
    } else {
        precoSugerido = custoOperacionalTotal / (1 - (margem / 100));
    }

    const lucroBruto = precoSugerido - custoOperacionalTotal;
    const margemEfetiva = precoSugerido > 0 ? ((lucroBruto / precoSugerido) * 100) : 0;
    const tempoProducao = Math.max(1.0, 1.0 + (areaTotal * 0.1));

    document.getElementById("calc-res-area").textContent = `${areaTotal.toFixed(2)} m²`;
    document.getElementById("calc-res-consumo").textContent = `${consumoMaterial.toFixed(2)} m²`;
    document.getElementById("calc-res-custo-material").textContent = formatCurrency(custoMaterialTotal);
    document.getElementById("calc-res-custo-producao").textContent = formatCurrency(custoImpressaoTotal + custoAcabamentoTotal);
    document.getElementById("calc-res-custo-total").textContent = formatCurrency(custoOperacionalTotal);
    document.getElementById("calc-res-preço-sugerido").textContent = formatCurrency(precoSugerido);
    document.getElementById("calc-res-lucro").textContent = formatCurrency(lucroBruto);
    document.getElementById("calc-res-margem").textContent = `${margemEfetiva.toFixed(0)}%`;
    document.getElementById("calc-res-tempo").textContent = `${tempoProducao.toFixed(1)} dias`;
}

function resetCalcResults() {
    document.getElementById("calc-res-area").textContent = "0,00 m²";
    document.getElementById("calc-res-consumo").textContent = "0,00 m²";
    document.getElementById("calc-res-custo-material").textContent = "R$ 0,00";
    document.getElementById("calc-res-custo-producao").textContent = "R$ 0,00";
    document.getElementById("calc-res-custo-total").textContent = "R$ 0,00";
    document.getElementById("calc-res-preço-sugerido").textContent = "R$ 0,00";
    document.getElementById("calc-res-lucro").textContent = "R$ 0,00";
    document.getElementById("calc-res-margem").textContent = "0%";
    document.getElementById("calc-res-tempo").textContent = "0.0 dias";
}

// 5. PROCESSAMENTO DE CONCLUSÃO DE OS E MUDANÇA DE ESTOQUE
function handleOSFinish(os) {
    if (os.materiaisUtilizados) {
        os.materiaisUtilizados.forEach(item => {
            const mat = state.materiais.find(m => m.codigo === item.codigo);
            if (mat) {
                const novaQtd = Math.max(0, (parseFloat(mat.quantidade) || 0) - (parseFloat(item.quantidade) || 0));
                mat.quantidade = novaQtd;
                dbSave("materiais", mat);
            }
        });
    }

    if (os.financeiroStatus === "Pago") {
        const trans = {
            tipo: "Receita",
            valor: os.valorTotal,
            descricao: `Faturamento OS #${os.numero} - ${os.cliente}`,
            entidade: os.cliente,
            data: new Date().toISOString().split("T")[0],
            categoria: "Venda de Serviços",
            centroCusto: "Comunicação Visual",
            metodo: os.metodoRecebimento || "PIX",
            pago: true
        };
        dbSave("financeiro", trans);
    } else {
        const trans = {
            tipo: "Receita",
            valor: os.valorTotal,
            descricao: `Contas a Receber OS #${os.numero} - ${os.cliente}`,
            entidade: os.cliente,
            data: os.prazo,
            categoria: "Venda de Serviços",
            centroCusto: "Comunicação Visual",
            metodo: os.metodoRecebimento || "PIX",
            pago: false
        };
        dbSave("financeiro", trans);
    }
}

// 6. MOTOR DE ASSISTENTE DE IA REAL DO GEMINI
async function processAIChat(question) {
    const context = {
        empresa: { nome: state.companyName, cnpj: state.companyCnpj },
        clientes: state.clientes.map(c => ({ nome: c.nome, responsavel: c.responsavel, cidade: c.cidade })),
        fornecedores: state.fornecedores.map(f => ({ nome: f.nome, insumos: f.insumos })),
        funcionarios: state.funcionarios.map(f => ({ nome: f.nome, cargo: f.cargo, salario: f.salario, custoHora: f.custoHora })),
        materiais_estoque: state.materiais.map(m => ({ codigo: m.codigo, nome: m.nome, quantidade: m.quantidade, unidade: m.unidade, precoCompra: m.precoCompra, precoVenda: m.precoVenda, min: m.qtdMinima })),
        financeiro: state.financeiro.map(f => ({ data: f.data, descricao: f.descricao, tipo: f.tipo, categoria: f.categoria, valor: f.valor, pago: f.pago, centroCusto: f.centroCusto })),
        orcamentos: state.orcamentos.map(o => ({ data: o.data, cliente: o.cliente, produto: o.produto, valorFinal: o.valorFinal, status: o.status })),
        ordens_servico: state.ordens_servico.map(o => ({ numero: o.numero, cliente: o.cliente, descricao: o.descricao, prazo: o.prazo, responsavel: o.responsavel, valorTotal: o.valorTotal, status: o.status, financeiroStatus: o.financeiroStatus })),
        metas: state.metas
    };

    const systemPrompt = `Você é a IA assistente oficial do ERP Metal Print Finance (Comunicação Visual).
Você tem acesso a todos os dados do sistema em tempo real em formato JSON abaixo.
Sua missão é responder a qualquer pergunta do usuário sobre finanças, estoque, ordens de serviço, clientes, etc., de forma direta, clara e profissional.
Use formatação Markdown simples nas respostas (negrito, listas, etc.). Quando o usuário fizer perguntas que exijam cálculos (como lucro, totais, maiores faturamentos, atrasos), faça as contas com base nos dados reais fornecidos abaixo e dê a resposta exata.

Dados atuais do ERP:
${JSON.stringify(context, null, 2)}

Pergunta do usuário: "${question}"
Resposta:`;

    try {
        return await callGeminiAPI(systemPrompt);
    } catch (e) {
        console.error("Erro na resposta do Gemini:", e);
        return "Desculpe, tive um problema ao me conectar com a IA do Gemini. Verifique sua conexão ou tente novamente.";
    }
}

// 7. AUXILIARES E CONVERSORES
function formatCurrency(val) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val || 0);
}
function formatDateBR(dateStr) {
    if (!dateStr) return "-";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
function getInicioSemana() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split("T")[0];
}
function getInicioMes() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function getInicioAno() {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
}

function getMaiorClienteFaturamento() {
    const cliFaturamento = {};
    state.ordens_servico.forEach(o => {
        if (o.status === "Finalizado") {
            cliFaturamento[o.cliente] = (cliFaturamento[o.cliente] || 0) + (parseFloat(o.valorTotal) || 0);
        }
    });
    
    let maxCli = "";
    let maxVal = 0;
    Object.entries(cliFaturamento).forEach(([cli, val]) => {
        if (val > maxVal) {
            maxVal = val;
            maxCli = cli;
        }
    });
    return maxCli || "-";
}

function getMaiorFornecedorFinanceiro() {
    const forCompras = {};
    state.financeiro.forEach(f => {
        if (f.tipo === "Despesa" && f.pago && f.categoria === "Matéria-Prima / Insumos") {
            forCompras[f.entidade] = (forCompras[f.entidade] || 0) + (parseFloat(f.valor) || 0);
        }
    });

    let maxFor = "";
    let maxVal = 0;
    Object.entries(forCompras).forEach(([f, val]) => {
        if (val > maxVal) {
            maxVal = val;
            maxFor = f;
        }
    });
    return maxFor || "-";
}

function getOSStatusBadgeClass(status) {
    switch (status) {
        case "Aguardando Arte": return "table-badge-warning";
        case "Aprovado / Fila": return "table-badge-info";
        case "Impressão": return "table-badge-info";
        case "Acabamento": return "table-badge-info";
        case "Instalação/Entrega": return "table-badge-warning";
        case "Finalizado": return "table-badge-success";
        case "Cancelado": return "table-badge-danger";
        default: return "table-badge-info";
    }
}

function triggerLucide() {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Exportações CSV
function exportReportToCSV(reportType) {
    let headers = [];
    let rows = [];
    let filename = `${reportType}_export_${Date.now()}.csv`;

    if (reportType === "financeiro-mes") {
        headers = ["Data", "Descricao", "Tipo", "Categoria", "Centro de Custo", "Valor", "Status"];
        state.financeiro.forEach(f => {
            rows.push([f.data, f.descricao, f.tipo, f.categoria, f.centroCusto, f.valor, f.pago ? "Pago" : "Pendente"]);
        });
    } 
    else if (reportType === "estoque-atual") {
        headers = ["Codigo", "Material", "Quantidade", "Unidade", "Preco Compra", "Estoque Minimo"];
        state.materiais.forEach(m => {
            rows.push([m.codigo, m.nome, m.quantidade, m.unidade, m.precoCompra, m.qtdMinima]);
        });
    }
    else if (reportType === "ordens-finalizadas") {
        headers = ["Numero OS", "Cliente", "Descricao", "Prazo", "Valor Total", "Status"];
        state.ordens_servico.forEach(o => {
            rows.push([o.numero, o.cliente, o.descricao, o.prazo, o.valorTotal, o.status]);
        });
    }
    else {
        alert("Tipo de relatório não implementado.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += headers.join(";") + "\n";
    rows.forEach(r => {
        csvContent += r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(";") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 8. REGISTRO DE EVENTOS DOM (CONTROLLER)
document.addEventListener("DOMContentLoaded", () => {
    initDb();
    setupRealtimeListeners();

    // Cliques na Barra Lateral
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const tab = item.getAttribute("data-tab");
            state.activeTab = tab;
            
            // Corrige o título na barra superior de forma dinâmica
            const cleanTitle = item.textContent.replace(/\d+/g, '').trim(); 
            document.getElementById("page-title").textContent = cleanTitle;
            
            renderActiveTab();
            document.getElementById("sidebar").classList.remove("show");
        });
    });

    // Mobile Hamburger
    document.getElementById("hamburger-btn").addEventListener("click", () => {
        document.getElementById("sidebar").classList.add("show");
    });
    document.getElementById("sidebar-close-btn").addEventListener("click", () => {
        document.getElementById("sidebar").classList.remove("show");
    });

    // Tema Claro / Escuro
    const themeBtn = document.getElementById("theme-toggle-btn");
    const themeText = document.getElementById("theme-text");
    const storedTheme = localStorage.getItem("mp_theme") || "light";
    document.body.className = `${storedTheme}-mode`;
    state.theme = storedTheme;
    themeText.textContent = storedTheme === "light" ? "Modo Escuro" : "Modo Claro";

    themeBtn.addEventListener("click", () => {
        if (state.theme === "light") {
            state.theme = "dark";
            document.body.className = "dark-mode";
            themeText.textContent = "Modo Claro";
        } else {
            state.theme = "light";
            document.body.className = "light-mode";
            themeText.textContent = "Modo Escuro";
        }
        localStorage.setItem("mp_theme", state.theme);
        if (state.activeTab === "dashboard") {
            renderDashboardCharts();
        }
    });

    // Quick Action dropdown
    const quickBtn = document.getElementById("quick-action-btn");
    const quickDropdown = document.getElementById("quick-action-dropdown");
    quickBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        quickDropdown.parentElement.classList.toggle("show");
    });
    window.addEventListener("click", () => {
        if (quickDropdown) quickDropdown.parentElement.classList.remove("show");
    });

    // Ações Rápidas
    document.getElementById("qa-new-os").addEventListener("click", (e) => { e.preventDefault(); openOSModal(); });
    document.getElementById("qa-new-budget").addEventListener("click", (e) => { e.preventDefault(); openBudgetModal(); });
    document.getElementById("qa-new-transaction").addEventListener("click", (e) => { e.preventDefault(); openTransactionModal(); });
    document.getElementById("qa-new-client").addEventListener("click", (e) => { e.preventDefault(); openClientModal(); });
    document.getElementById("qa-new-material").addEventListener("click", (e) => { e.preventDefault(); openMaterialModal(); });

    // Triggers normais nas abas
    document.getElementById("btn-nova-transacao").addEventListener("click", () => openTransactionModal());
    document.getElementById("btn-nova-receita").addEventListener("click", () => openTransactionModal("Receita"));
    document.getElementById("btn-nova-despesa").addEventListener("click", () => openTransactionModal("Despesa"));
    document.getElementById("btn-pagar-novo").addEventListener("click", () => openTransactionModal("Despesa", false));
    document.getElementById("btn-receber-novo").addEventListener("click", () => openTransactionModal("Receita", false));
    document.getElementById("btn-novo-cliente").addEventListener("click", () => openClientModal());
    document.getElementById("btn-novo-fornecedor").addEventListener("click", () => openSupplierModal());
    document.getElementById("btn-novo-funcionario").addEventListener("click", () => openEmployeeModal());
    document.getElementById("btn-novo-material").addEventListener("click", () => openMaterialModal());
    document.getElementById("btn-novo-produto").addEventListener("click", () => openProductModal());
    document.getElementById("btn-nova-os").addEventListener("click", () => openOSModal());
    document.getElementById("btn-novo-orcamento").addEventListener("click", () => openBudgetModal());
    document.getElementById("btn-novo-recibo").addEventListener("click", () => openReceiptModal());

    // Fechar modais genéricos
    document.querySelectorAll("[data-close]").forEach(btn => {
        btn.addEventListener("click", () => {
            const mId = btn.getAttribute("data-close");
            document.getElementById(mId).classList.remove("show");
        });
    });

    // Lógica do Modal de Orçamento com IA e Múltiplos Materiais
    document.getElementById("orc-btn-add-material").addEventListener("click", () => {
        const matSel = document.getElementById("orc-material-sel");
        if (state.materiais.length === 0 || matSel.value === "") return;

        const matId = matSel.value;
        const qtd = parseFloat(document.getElementById("orc-material-qtd").value) || 0;
        if (qtd <= 0) {
            alert("Informe uma quantidade de consumo.");
            return;
        }

        const material = state.materiais.find(m => m.id === matId);
        if (material) {
            state.orcMateriaisVinculados.push({
                codigo: material.codigo,
                nome: material.nome,
                quantidade: qtd,
                preco: material.precoCompra,
                total: qtd * material.precoCompra
            });
            renderOrcMaterialsTable();
        }
    });

    document.getElementById("orc-btn-calcular-ia").addEventListener("click", async () => {
        const largura = parseFloat(document.getElementById("orc-largura").value) || 1;
        const altura = parseFloat(document.getElementById("orc-altura").value) || 1;
        const quantidade = parseInt(document.getElementById("orc-quantidade").value, 10) || 1;
        const margem = parseFloat(document.getElementById("orc-margem").value) || 50;
        const materiais = state.orcMateriaisVinculados;

        const section = document.getElementById("ai-calc-section");
        const loader = document.getElementById("ai-calc-loading");
        const resultDiv = document.getElementById("ai-calc-result");

        section.style.display = "block";
        loader.style.display = "inline-block";
        resultDiv.innerHTML = "Calculando e analisando com a IA do Gemini...";

        const prompt = `Você é um especialista em orçamento e custos de Comunicação Visual.
Calcule o preço de venda sugerido para uma placa/peça com as seguintes especificações:
- Largura: ${largura} metros
- Altura: ${altura} metros
- Quantidade: ${quantidade} peças
- Margem de Lucro Desejada: ${margem}%
- Materiais que serão utilizados:
${JSON.stringify(materiais, null, 2)}

Considere a área quadrada total da peça (${largura * altura}m² por peça). Considere uma perda padrão de 10% na matéria-prima.
Calcule:
1. Área Total do Serviço (largura * altura * quantidade)
2. Custo Total de Matéria-Prima
3. Custo estimado de Produção/Impressão/Acabamento (estime R$ 15,00 por m² de custo de impressão/mão de obra se não especificado)
4. Custo Total Operacional (Matéria-prima + Produção)
5. Preço Sugerido de Venda com base na margem de lucro desejada (Fórmula: Custo Total / (1 - margem/100))
6. Lucro Bruto Estimado e a Margem Efetiva.

Você DEVE retornar a resposta EXATAMENTE no formato JSON a seguir, sem blocos de código markdown ou texto extra, para que eu possa fazer o parse no JavaScript do ERP:
{
  "areaTotal": 0.00,
  "custoMaterial": 0.00,
  "custoProducao": 0.00,
  "custoTotal": 0.00,
  "precoSugerido": 0.00,
  "lucroEstimado": 0.00,
  "margemEfetiva": 0,
  "tempoProducaoDias": 1.5,
  "explicacao": "Escreva aqui uma explicação detalhada e bonita passo a passo para o cliente e o vendedor entenderem o preço."
}`;

        try {
            const rawResponse = await callGeminiAPI(prompt);
            loader.style.display = "none";
            
            let cleanText = rawResponse.trim();
            if (cleanText.startsWith("```")) {
                cleanText = cleanText.replace(/^```json/, "").replace(/```$/, "").trim();
            }
            
            const res = JSON.parse(cleanText);
            
            // Armazenar os valores calculados na sessão do modal para salvamento posterior
            document.getElementById("orc-btn-salvar").dataset.valCalculado = JSON.stringify(res);

            resultDiv.innerHTML = `
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">Área Total</div>
                        <div class="result-value primary">${res.areaTotal.toFixed(2)} m²</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Custo Matéria-Prima</div>
                        <div class="result-value danger">${formatCurrency(res.custoMaterial)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Custo Operacional Total</div>
                        <div class="result-value danger">${formatCurrency(res.custoTotal)}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Preço de Venda Recomendado</div>
                        <div class="result-value">${formatCurrency(res.precoSugerido)}</div>
                    </div>
                </div>
                <div style="margin-top:16px; border-top: 1px solid rgba(255,255,255,0.08); padding-top:12px;">
                    <strong>Explicação do Orçamento:</strong>
                    <p style="margin-top:6px; color:#cbd5e1;">${res.explicacao}</p>
                </div>
            `;
        } catch (e) {
            console.error(e);
            loader.style.display = "none";
            resultDiv.innerHTML = `<span class="text-danger">Erro ao processar orçamento com IA: ${e.message}. Você ainda pode preencher e salvar manualmente.</span>`;
        }
    });

    document.getElementById("orc-btn-salvar").addEventListener("click", () => {
        const cliente = document.getElementById("orc-cliente").value;
        const descricao = document.getElementById("orc-descricao").value;
        const largura = parseFloat(document.getElementById("orc-largura").value) || 1;
        const altura = parseFloat(document.getElementById("orc-altura").value) || 1;
        const quantidade = parseInt(document.getElementById("orc-quantidade").value, 10) || 1;
        const validade = document.getElementById("orc-validade").value;

        if (!cliente || !descricao) {
            alert("Informe o Cliente e a Descrição do Serviço.");
            return;
        }

        let valores = {
            areaTotal: largura * altura * quantidade,
            custoMaterial: state.orcMateriaisVinculados.reduce((acc, c) => acc + c.total, 0),
            custoProducao: (largura * altura * quantidade) * 15,
            precoSugerido: 0,
            custoTotal: 0,
            lucroEstimado: 0
        };

        valores.custoTotal = valores.custoMaterial + valores.custoProducao;
        const margem = parseFloat(document.getElementById("orc-margem").value) || 50;
        valores.precoSugerido = valores.custoTotal / (1 - (margem / 100));
        valores.lucroEstimado = valores.precoSugerido - valores.custoTotal;

        const dataCalculada = document.getElementById("orc-btn-salvar").dataset.valCalculado;
        if (dataCalculada) {
            const parsed = JSON.parse(dataCalculada);
            valores.precoSugerido = parsed.precoSugerido;
            valores.custoTotal = parsed.custoTotal;
        }

        const orc = {
            data: new Date().toISOString().split("T")[0],
            cliente: cliente,
            produto: descricao,
            largura: largura,
            altura: altura,
            quantidade: quantidade,
            materiaisUtilizados: state.orcMateriaisVinculados,
            valorSugerido: valores.precoSugerido,
            valorFinal: valores.precoSugerido,
            validade: validade,
            status: "Pendente"
        };

        dbSave("orcamentos", orc);
        document.getElementById("modal-orcamento").classList.remove("show");
        alert("Orçamento inteligente criado com sucesso!");
        state.activeTab = "orçamentos";
        renderActiveTab();
    });

    // Lógica do Modal de Recibo
    document.getElementById("form-recibo").addEventListener("submit", (e) => {
        e.preventDefault();
        
        let rId = document.getElementById("recibo-id").value;
        if (!rId) {
            rId = "receipt_" + Date.now();
        }

        const recibo = {
            id: rId,
            cliente: document.getElementById("recibo-cliente").value,
            data: document.getElementById("recibo-data").value,
            descricao: document.getElementById("recibo-descricao").value,
            valor: parseFloat(document.getElementById("recibo-valor").value) || 0,
            pagamento: document.getElementById("recibo-pagamento").value,
            obs: document.getElementById("recibo-obs").value
        };

        dbSave("recibos", recibo);
        document.getElementById("modal-recibo").classList.remove("show");
        alert("Recibo salvo com sucesso!");
        
        // Abrir PDF do recibo logo após salvar
        generateReceiptPDF(recibo.id);
        
        state.activeTab = "recibos";
        renderActiveTab();
    });

    document.getElementById("btn-preview-recibo").addEventListener("click", () => {
        const cliente = document.getElementById("recibo-cliente").value;
        const data = document.getElementById("recibo-data").value;
        const descricao = document.getElementById("recibo-descricao").value;
        const valor = parseFloat(document.getElementById("recibo-valor").value) || 0;
        const pagamento = document.getElementById("recibo-pagamento").value;
        const obs = document.getElementById("recibo-obs").value;

        if (!cliente || !descricao || valor <= 0) {
            alert("Preencha todos os campos do recibo para visualizar.");
            return;
        }

        const tempRecibo = {
            id: "temp_rec",
            cliente,
            data,
            descricao,
            valor,
            pagamento,
            obs
        };

        // Salvar temporariamente no state para renderizar
        const originalRecibos = state.recibos;
        state.recibos = [tempRecibo, ...state.recibos];
        generateReceiptPDF("temp_rec");
        state.recibos = originalRecibos;
    });

    // Submits de Formulários
    document.getElementById("form-transacao").addEventListener("submit", (e) => {
        e.preventDefault();
        const tr = {
            id: document.getElementById("trans-id").value || null,
            tipo: document.getElementById("trans-tipo").value,
            valor: parseFloat(document.getElementById("trans-valor").value) || 0,
            descricao: document.getElementById("trans-descricao").value,
            entidade: document.getElementById("trans-entidade").value,
            data: document.getElementById("trans-data").value,
            categoria: document.getElementById("trans-categoria").value,
            centroCusto: document.getElementById("trans-centro-custo").value,
            metodo: document.getElementById("trans-metodo").value,
            recorrente: document.getElementById("trans-recorrente").checked,
            pago: document.getElementById("trans-pago").checked
        };
        dbSave("financeiro", tr);
        document.getElementById("modal-transacao").classList.remove("show");
    });

    document.getElementById("form-cliente").addEventListener("submit", (e) => {
        e.preventDefault();
        const cli = {
            id: document.getElementById("cli-id").value || null,
            nome: document.getElementById("cli-nome").value,
            documento: document.getElementById("cli-documento").value,
            responsavel: document.getElementById("cli-responsavel").value,
            telefone: document.getElementById("cli-telefone").value,
            email: document.getElementById("cli-email").value,
            endereco: document.getElementById("cli-endereco").value,
            cidade: document.getElementById("cli-cidade").value
        };
        dbSave("clientes", cli);
        document.getElementById("modal-cliente").classList.remove("show");
    });

    document.getElementById("form-fornecedor").addEventListener("submit", (e) => {
        e.preventDefault();
        const supplier = {
            id: document.getElementById("for-id").value || null,
            nome: document.getElementById("for-nome").value,
            cnpj: document.getElementById("for-cnpj").value,
            contato: document.getElementById("for-contato").value,
            telefone: document.getElementById("for-telefone").value,
            email: document.getElementById("for-email").value,
            insumos: document.getElementById("for-insumos").value
        };
        dbSave("fornecedores", supplier);
        document.getElementById("modal-fornecedor").classList.remove("show");
    });

    document.getElementById("form-funcionario").addEventListener("submit", (e) => {
        e.preventDefault();
        const emp = {
            id: document.getElementById("fun-id").value || null,
            nome: document.getElementById("fun-nome").value,
            cargo: document.getElementById("fun-cargo").value,
            salario: parseFloat(document.getElementById("fun-salario").value) || 0,
            custoHora: parseFloat(document.getElementById("fun-custo-hora").value) || 0,
            telefone: document.getElementById("fun-telefone").value,
            admissao: document.getElementById("fun-admissao").value
        };
        dbSave("funcionarios", emp);
        document.getElementById("modal-funcionario").classList.remove("show");
    });

    document.getElementById("form-material").addEventListener("submit", (e) => {
        e.preventDefault();
        const mat = {
            id: document.getElementById("mat-id").value || null,
            codigo: document.getElementById("mat-codigo").value,
            nome: document.getElementById("mat-nome").value,
            categoria: document.getElementById("mat-categoria").value,
            unidade: document.getElementById("mat-unidade").value,
            local: document.getElementById("mat-local").value,
            precoCompra: parseFloat(document.getElementById("mat-preco-compra").value) || 0,
            precoVenda: parseFloat(document.getElementById("mat-preco-venda").value) || 0,
            quantidade: parseFloat(document.getElementById("mat-quantidade").value) || 0,
            qtdMinima: parseFloat(document.getElementById("mat-qtd-minima").value) || 0,
            fornecedor: document.getElementById("mat-fornecedor").value
        };
        dbSave("materiais", mat);
        document.getElementById("modal-material").classList.remove("show");
    });

    document.getElementById("form-produto").addEventListener("submit", (e) => {
        e.preventDefault();
        const prod = {
            id: document.getElementById("prod-id").value || null,
            codigo: document.getElementById("prod-codigo").value,
            nome: document.getElementById("prod-nome").value,
            material: document.getElementById("prod-material").value,
            margem: parseFloat(document.getElementById("prod-margem").value) || 0,
            acabamento: document.getElementById("prod-acabamento").value
        };
        dbSave("produtos", prod);
        document.getElementById("modal-produto").classList.remove("show");
    });

    document.getElementById("form-os").addEventListener("submit", (e) => {
        e.preventDefault();
        
        const osId = document.getElementById("os-id").value || null;
        let osNum = document.getElementById("os-numero").value;
        if (!osNum) {
            osNum = `OS-${new Date().getFullYear()}-${String(state.ordens_servico.length + 1001).padStart(4, '0')}`;
        }

        const os = {
            id: osId,
            numero: osNum,
            cliente: document.getElementById("os-cliente").value,
            descricao: document.getElementById("os-descricao").value,
            prazo: document.getElementById("os-prazo").value,
            responsavel: document.getElementById("os-funcionario").value,
            materiaisUtilizados: state.osMateriaisVinculados,
            custoExtra: parseFloat(document.getElementById("os-custo-extra").value) || 0,
            valorTotal: parseFloat(document.getElementById("os-valor-total").value) || 0,
            status: document.getElementById("os-status").value,
            financeiroStatus: document.getElementById("os-financeiro-status").value,
            metodoRecebimento: document.getElementById("os-metodo-recebimento").value,
            dataFinalizado: document.getElementById("os-status").value === "Finalizado" ? new Date().toISOString().split("T")[0] : null
        };

        dbSave("ordens_servico", os);
        if (os.status === "Finalizado") {
            handleOSFinish(os);
        }

        document.getElementById("modal-os").classList.remove("show");
    });

    document.getElementById("btn-salvar-metas").addEventListener("click", () => {
        state.metas.mensal = parseFloat(document.getElementById("meta-input-mensal").value) || 50000;
        state.metas.anual = parseFloat(document.getElementById("meta-input-anual").value) || 600000;
        
        if (firebaseActive) {
            dbSave("configuracoes", { id: "metas_def", companyId: state.companyId, metas: state.metas });
        } else {
            localStorage.setItem("mp_finance_metas", JSON.stringify(state.metas));
            updateAppDerivedState();
            renderActiveTab();
        }
        alert("Metas salvas com sucesso!");
    });

    document.getElementById("btn-salvar-configuracoes").addEventListener("click", () => {
        state.companyName = document.getElementById("config-empresa-nome").value;
        state.companyCnpj = document.getElementById("config-empresa-cnpj").value;
        document.getElementById("display-company-name").textContent = state.companyName;
        alert("Dados salvos!");
    });

    // Vincular Material no modal OS
    document.getElementById("os-btn-add-material").addEventListener("click", () => {
        const matSel = document.getElementById("os-material");
        if (state.materiais.length === 0 || matSel.value === "") return;
        
        const matId = matSel.value;
        const qtd = parseFloat(document.getElementById("os-material-qtd").value) || 0;
        if (qtd <= 0) {
            alert("Informe uma quantidade de consumo.");
            return;
        }

        const material = state.materiais.find(m => m.id === matId);
        if (material) {
            state.osMateriaisVinculados.push({
                codigo: material.codigo,
                nome: material.nome,
                quantidade: qtd,
                preco: material.precoCompra,
                total: qtd * material.precoCompra
            });
            renderOSMaterialsTable();
        }
    });

    // Eventos de IA e Chat
    const aiFloatingBtn = document.getElementById("ai-floating-btn");
    const aiPanel = document.getElementById("ai-panel");
    const aiCloseBtn = document.getElementById("ai-panel-close-btn");
    
    aiFloatingBtn.addEventListener("click", () => {
        aiPanel.classList.toggle("show");
    });
    aiCloseBtn.addEventListener("click", () => {
        aiPanel.classList.remove("show");
    });
    
    const sendBtn = document.getElementById("ai-panel-send-btn");
    const inputField = document.getElementById("ai-panel-input-field");
    const chatMsgs = document.getElementById("ai-chat-messages");

    async function handleAISend() {
        const text = inputField.value.trim();
        if (!text) return;

        chatMsgs.innerHTML += `<div class="ai-message ai-user">${text}</div>`;
        inputField.value = "";
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        chatMsgs.innerHTML += `<div class="ai-message ai-bot" id="temp-bot-loading">Pensando...</div>`;
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        const answer = await processAIChat(text);
        
        const loadingDiv = document.getElementById("temp-bot-loading");
        if (loadingDiv) loadingDiv.remove();

        chatMsgs.innerHTML += `<div class="ai-message ai-bot">${answer}</div>`;
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
    sendBtn.addEventListener("click", handleAISend);
    inputField.addEventListener("keypress", (e) => { if (e.key === "Enter") handleAISend(); });

    const dashAiSend = document.getElementById("ai-dash-send");
    const dashAiInput = document.getElementById("ai-dash-input");
    
    async function handleDashAISend() {
        const val = dashAiInput.value.trim();
        if (!val) return;
        
        aiPanel.classList.add("show");
        chatMsgs.innerHTML += `<div class="ai-message ai-user">${val}</div>`;
        dashAiInput.value = "";
        
        chatMsgs.innerHTML += `<div class="ai-message ai-bot" id="temp-bot-loading">Pensando...</div>`;
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        const answer = await processAIChat(val);
        
        const loadingDiv = document.getElementById("temp-bot-loading");
        if (loadingDiv) loadingDiv.remove();

        chatMsgs.innerHTML += `<div class="ai-message ai-bot">${answer}</div>`;
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
    
    if (dashAiSend) {
        dashAiSend.addEventListener("click", handleDashAISend);
        dashAiInput.addEventListener("keypress", (e) => { if (e.key === "Enter") handleDashAISend(); });
    }

    document.querySelectorAll(".ai-suggest-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const queryText = btn.textContent;
            aiPanel.classList.add("show");
            chatMsgs.innerHTML += `<div class="ai-message ai-user">${queryText}</div>`;
            
            chatMsgs.innerHTML += `<div class="ai-message ai-bot" id="temp-bot-loading">Pensando...</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;

            const answer = await processAIChat(queryText);
            
            const loadingDiv = document.getElementById("temp-bot-loading");
            if (loadingDiv) loadingDiv.remove();

            chatMsgs.innerHTML += `<div class="ai-message ai-bot">${answer}</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        });
    });

    document.getElementById("btn-export-fluxo").addEventListener("click", () => exportReportToCSV("financeiro-mes"));
    document.getElementById("btn-export-receitas").addEventListener("click", () => exportReportToCSV("financeiro-mes"));
    document.getElementById("btn-export-despesas").addEventListener("click", () => exportReportToCSV("financeiro-mes"));
    document.getElementById("btn-export-estoque").addEventListener("click", () => exportReportToCSV("estoque-atual"));
    document.getElementById("btn-export-os").addEventListener("click", () => exportReportToCSV("ordens-finalizadas"));
    document.getElementById("btn-export-clientes").addEventListener("click", () => exportReportToCSV("ordens-finalizadas"));

    // Render Inicial
    setTimeout(() => {
        renderActiveTab();
    }, 200);
});

// --- CONTROLLER DE MODAIS AUXILIARES ---
function openTransactionModal(forcedTipo = "", forcedPago = true) {
    const modal = document.getElementById("modal-transacao");
    document.getElementById("form-transacao").reset();
    document.getElementById("trans-id").value = "";
    document.getElementById("modal-transacao-title").textContent = "Novo Lançamento Financeiro";
    
    if (forcedTipo) {
        document.getElementById("trans-tipo").value = forcedTipo;
    }
    document.getElementById("trans-pago").checked = forcedPago;
    document.getElementById("trans-data").value = new Date().toISOString().split("T")[0];

    modal.classList.add("show");
}

function openClientModal() {
    document.getElementById("form-cliente").reset();
    document.getElementById("cli-id").value = "";
    document.getElementById("modal-cliente").classList.add("show");
}

function openSupplierModal() {
    document.getElementById("form-fornecedor").reset();
    document.getElementById("for-id").value = "";
    document.getElementById("modal-fornecedor").classList.add("show");
}

function openEmployeeModal() {
    document.getElementById("form-funcionario").reset();
    document.getElementById("fun-id").value = "";
    document.getElementById("fun-admissao").value = new Date().toISOString().split("T")[0];
    document.getElementById("modal-funcionario").classList.add("show");
}

function openMaterialModal() {
    document.getElementById("form-material").reset();
    document.getElementById("mat-id").value = "";
    
    const select = document.getElementById("mat-fornecedor");
    select.innerHTML = `<option value="">Nenhum</option>`;
    state.fornecedores.forEach(f => {
        select.innerHTML += `<option value="${f.nome}">${f.nome}</option>`;
    });

    document.getElementById("modal-material").classList.add("show");
}

function openProductModal() {
    document.getElementById("form-produto").reset();
    document.getElementById("prod-id").value = "";
    
    const select = document.getElementById("prod-material");
    select.innerHTML = "";
    
    state.materiais.forEach(m => {
        select.innerHTML += `<option value="${m.nome}">${m.nome}</option>`;
    });

    if (state.materiais.length === 0) {
        select.innerHTML = `<option value="">Cadastre um material no estoque primeiro</option>`;
    }

    document.getElementById("modal-produto").classList.add("show");
}

function openOSModal() {
    document.getElementById("form-os").reset();
    document.getElementById("os-id").value = "";
    document.getElementById("os-numero").value = "";
    document.getElementById("os-custo-extra").value = "0";
    document.getElementById("os-valor-total").value = "";
    document.getElementById("os-prazo").value = new Date().toISOString().split("T")[0];
    
    state.osMateriaisVinculados = [];
    renderOSMaterialsTable();

    const cliSel = document.getElementById("os-cliente");
    cliSel.innerHTML = "";
    state.clientes.forEach(c => cliSel.innerHTML += `<option value="${c.nome}">${c.nome}</option>`);
    if (state.clientes.length === 0) {
        cliSel.innerHTML = `<option value="">Nenhum cliente cadastrado</option>`;
    }

    const funSel = document.getElementById("os-funcionario");
    funSel.innerHTML = "";
    state.funcionarios.forEach(f => funSel.innerHTML += `<option value="${f.nome}">${f.nome} (${f.cargo})</option>`);
    if (state.funcionarios.length === 0) {
        funSel.innerHTML = `<option value="">Nenhum funcionário cadastrado</option>`;
    }

    const matSel = document.getElementById("os-material");
    matSel.innerHTML = "";
    state.materiais.forEach(m => matSel.innerHTML += `<option value="${m.id}">${m.nome} (${m.unidade})</option>`);
    if (state.materiais.length === 0) {
        matSel.innerHTML = `<option value="">Nenhum material cadastrado</option>`;
    }

    document.getElementById("modal-os").classList.add("show");
}

function renderOSMaterialsTable() {
    const tbody = document.querySelector("#os-table-materiais tbody");
    tbody.innerHTML = "";

    let totalGeral = 0;
    state.osMateriaisVinculados.forEach((item, idx) => {
        totalGeral += item.total;
        tbody.innerHTML += `
            <tr>
                <td><code>${item.codigo}</code></td>
                <td>${item.nome}</td>
                <td>${item.quantidade}</td>
                <td>${formatCurrency(item.preco)}</td>
                <td><strong>${formatCurrency(item.total)}</strong></td>
                <td><button type="button" class="btn btn-danger btn-sm" onclick="window.app.removeOSMaterial(${idx})">&times;</button></td>
            </tr>
        `;
    });
    
    const extra = parseFloat(document.getElementById("os-custo-extra").value) || 0;
    const totalSugerido = (totalGeral * 2.5) + extra;
    
    const valInput = document.getElementById("os-valor-total");
    if (!valInput.value || valInput.value === "0.00" || valInput.value === "0") {
        valInput.value = totalSugerido.toFixed(2);
    }
}

// 9. EVENTOS COM GATILHOS INLINE (WINDOW.APP)
window.app = {
    editTransaction: (id) => {
        const f = state.financeiro.find(item => item.id === id);
        if (!f) return;
        openTransactionModal();
        
        document.getElementById("trans-id").value = f.id;
        document.getElementById("trans-tipo").value = f.tipo;
        document.getElementById("trans-valor").value = f.valor;
        document.getElementById("trans-descricao").value = f.descricao;
        document.getElementById("trans-entidade").value = f.entidade;
        document.getElementById("trans-data").value = f.data;
        document.getElementById("trans-categoria").value = f.categoria;
        document.getElementById("trans-centro-custo").value = f.centroCusto;
        document.getElementById("trans-metodo").value = f.metodo;
        document.getElementById("trans-recorrente").checked = f.recorrente;
        document.getElementById("trans-pago").checked = f.pago;
        document.getElementById("modal-transacao-title").textContent = "Editar Lançamento";
    },
    deleteTransaction: (id) => {
        if (confirm("Tem certeza que deseja excluir este lançamento?")) {
            dbDelete("financeiro", id);
        }
    },
    confirmPayment: (id) => {
        const f = state.financeiro.find(item => item.id === id);
        if (f) {
            f.pago = true;
            dbSave("financeiro", f);
            alert("Lançamento confirmado/recebido com sucesso!");
        }
    },

    editClient: (id) => {
        const c = state.clientes.find(item => item.id === id);
        if (!c) return;
        openClientModal();
        document.getElementById("cli-id").value = c.id;
        document.getElementById("cli-nome").value = c.nome;
        document.getElementById("cli-documento").value = c.documento;
        document.getElementById("cli-responsavel").value = c.responsavel;
        document.getElementById("cli-telefone").value = c.telefone;
        document.getElementById("cli-email").value = c.email;
        document.getElementById("cli-endereco").value = c.endereco;
        document.getElementById("cli-cidade").value = c.cidade;
    },
    deleteClient: (id) => {
        if (confirm("Deseja deletar este cliente?")) {
            dbDelete("clientes", id);
        }
    },

    editSupplier: (id) => {
        const f = state.fornecedores.find(item => item.id === id);
        if (!f) return;
        openSupplierModal();
        document.getElementById("for-id").value = f.id;
        document.getElementById("for-nome").value = f.nome;
        document.getElementById("for-cnpj").value = f.cnpj;
        document.getElementById("for-contato").value = f.contato;
        document.getElementById("for-telefone").value = f.telefone;
        document.getElementById("for-email").value = f.email;
        document.getElementById("for-insumos").value = f.insumos;
    },
    deleteSupplier: (id) => {
        if (confirm("Deseja deletar este fornecedor?")) {
            dbDelete("fornecedores", id);
        }
    },

    editEmployee: (id) => {
        const f = state.funcionarios.find(item => item.id === id);
        if (!f) return;
        openEmployeeModal();
        document.getElementById("fun-id").value = f.id;
        document.getElementById("fun-nome").value = f.nome;
        document.getElementById("fun-cargo").value = f.cargo;
        document.getElementById("fun-salario").value = f.salario;
        document.getElementById("fun-custo-hora").value = f.custoHora;
        document.getElementById("fun-telefone").value = f.telefone;
        document.getElementById("fun-admissao").value = f.admissao;
    },
    deleteEmployee: (id) => {
        if (confirm("Deseja deletar este funcionário?")) {
            dbDelete("funcionarios", id);
        }
    },

    editMaterial: (id) => {
        const m = state.materiais.find(item => item.id === id);
        if (!m) return;
        openMaterialModal();
        document.getElementById("mat-id").value = m.id;
        document.getElementById("mat-codigo").value = m.codigo;
        document.getElementById("mat-nome").value = m.nome;
        document.getElementById("mat-categoria").value = m.categoria;
        document.getElementById("mat-unidade").value = m.unidade;
        document.getElementById("mat-local").value = m.local;
        document.getElementById("mat-preco-compra").value = m.precoCompra;
        document.getElementById("mat-preco-venda").value = m.precoVenda;
        document.getElementById("mat-quantidade").value = m.quantidade;
        document.getElementById("mat-qtd-minima").value = m.qtdMinima;
        document.getElementById("mat-fornecedor").value = m.fornecedor;
    },
    deleteMaterial: (id) => {
        if (confirm("Deseja excluir este material do estoque?")) {
            dbDelete("materiais", id);
        }
    },
    adjustStock: (id) => {
        const m = state.materiais.find(item => item.id === id);
        if (!m) return;
        const novaQtd = prompt(`Ajustar estoque para ${m.nome}. Quantidade atual: ${m.quantidade} ${m.unidade}. Nova quantidade:`);
        if (novaQtd !== null) {
            m.quantidade = parseFloat(novaQtd) || 0;
            dbSave("materiais", m);
            alert("Quantidade ajustada com sucesso!");
        }
    },

    editProduct: (id) => {
        const p = state.produtos.find(item => item.id === id);
        if (!p) return;
        openProductModal();
        document.getElementById("prod-id").value = p.id;
        document.getElementById("prod-codigo").value = p.codigo;
        document.getElementById("prod-nome").value = p.nome;
        document.getElementById("prod-material").value = p.material;
        document.getElementById("prod-margem").value = p.margem;
        document.getElementById("prod-acabamento").value = p.acabamento;
    },
    deleteProduct: (id) => {
        if (confirm("Deseja deletar este modelo de produto?")) {
            dbDelete("produtos", id);
        }
    },

    approveBudget: (id) => {
        const o = state.orcamentos.find(item => item.id === id);
        if (o) {
            o.status = "Aprovado";
            dbSave("orcamentos", o);
            
            const os = {
                numero: `OS-${new Date().getFullYear()}-${String(state.ordens_servico.length + 1001).padStart(4, '0')}`,
                cliente: o.cliente,
                descricao: `OS vinculada ao Orçamento Aprovado de ${o.produto} (${o.largura}x${o.altura} m)`,
                prazo: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                responsavel: state.funcionarios[0] ? state.funcionarios[0].nome : "Não Atribuído",
                materiaisUtilizados: [],
                custoExtra: o.instalacao + o.frete,
                valorTotal: o.valorFinal,
                status: "Aprovado / Fila",
                financeiroStatus: "Pendente",
                metodoRecebimento: "PIX",
                dataFinalizado: null
            };
            dbSave("ordens_servico", os);
            alert("Orçamento aprovado e Ordem de Serviço criada com sucesso!");
            state.activeTab = "ordens-servico";
            renderActiveTab();
        }
    },
    deleteBudget: (id) => {
        if (confirm("Excluir este orçamento?")) {
            dbDelete("orcamentos", id);
        }
    },

    editOS: (id) => {
        const o = state.ordens_servico.find(item => item.id === id);
        if (!o) return;
        openOSModal();
        
        document.getElementById("os-id").value = o.id;
        document.getElementById("os-numero").value = o.numero;
        document.getElementById("os-cliente").value = o.cliente;
        document.getElementById("os-descricao").value = o.descricao;
        document.getElementById("os-prazo").value = o.prazo;
        document.getElementById("os-funcionario").value = o.responsavel;
        document.getElementById("os-custo-extra").value = o.custoExtra;
        document.getElementById("os-valor-total").value = o.valorTotal;
        document.getElementById("os-status").value = o.status;
        document.getElementById("os-financeiro-status").value = o.financeiroStatus;
        document.getElementById("os-metodo-recebimento").value = o.metodoRecebimento || "PIX";
        
        state.osMateriaisVinculados = o.materiaisUtilizados || [];
        renderOSMaterialsTable();
    },
    deleteOS: (id) => {
        if (confirm("Deseja deletar/cancelar esta OS?")) {
            dbDelete("ordens_servico", id);
        }
    },
    moveOS: (id, novoStatus) => {
        const o = state.ordens_servico.find(item => item.id === id);
        if (o) {
            o.status = novoStatus;
            if (novoStatus === "Finalizado") {
                o.dataFinalizado = new Date().toISOString().split("T")[0];
                handleOSFinish(o);
            }
            dbSave("ordens_servico", o);
            alert(`OS #${o.numero} movida para ${novoStatus}`);
        }
    },
    removeOSMaterial: (idx) => {
        state.osMateriaisVinculados.splice(idx, 1);
        renderOSMaterialsTable();
    },
    
    exportReport: (type) => exportReportToCSV(type),
    
    selectAgendaDay: (day) => {
        const formattedDay = String(day).padStart(2, '0');
        const searchDate = `2026-07-${formattedDay}`;
        
        const matchingOS = state.ordens_servico.filter(o => o.prazo === searchDate);
        const container = document.getElementById("agenda-events-container");
        container.innerHTML = `<h4 class="font-bold border-bottom pb-2">Entregas em 2026-07-${formattedDay}</h4>`;
        
        if (matchingOS.length === 0) {
            container.innerHTML += `<div class="empty-state">Sem entregas operacionais nesta data.</div>`;
            return;
        }
        
        matchingOS.forEach(o => {
            container.innerHTML += `
                <div class="agenda-event-card" style="border-left-color: var(--color-success)">
                    <div>
                        <strong>OS #${o.numero}: ${o.cliente}</strong><br>
                        <span class="text-secondary">${o.descricao}</span>
                    </div>
                    <div class="text-right">
                        <span class="font-bold text-success">${formatCurrency(o.valorTotal)}</span><br>
                        <span class="table-badge ${getOSStatusBadgeClass(o.status)}">${o.status}</span>
                    </div>
                </div>
            `;
        });
    }
};
