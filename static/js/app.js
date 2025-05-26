let participants = [];
let savedExpenses = [];
let groupId = window.location.pathname.split('/g/').pop();

document.addEventListener('DOMContentLoaded', () => {
    // Load initial data
    fetch(`/api/g/${groupId}`)
        .then(response => response.json())
        .then(data => {
            if (data.participants) {
                participants = data.participants;
                updateParticipantList();
                updateAllParticipantSelects();
            }
            if (data.expenses) {
                savedExpenses = data.expenses;
                updateExpenseTable();
            }
        })
        .catch(error => console.error('Error loading expenses:', error));
        
    // Add window resize listener to update the view based on screen size
    window.addEventListener('resize', debounce(function() {
        if (document.querySelector('#view-expenses.active, #view-expenses.show')) {
            updateExpenseTable();
        }
    }, 250));
    
    // Add listener for tab changes to ensure mobile view switches correctly
    document.getElementById('view-expenses-tab').addEventListener('shown.bs.tab', function() {
        updateExpenseTable();
    });
});

// Debounce function to prevent excessive calls during window resize
function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };
}

function saveToBackend() {
    fetch(`/api/g/${groupId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            participants,
            expenses: savedExpenses
        })
    }).catch(error => console.error('Error saving expenses:', error));
}

async function exportGroupData() {
    try {
        const response = await fetch(`/api/g/${groupId}/export`);
        if (!response.ok) {
            throw new Error('Failed to export data');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expense_group_${groupId}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        const toastDiv = document.createElement('div');
        toastDiv.innerHTML = `
            <div class="toast-container position-fixed bottom-0 end-0 p-3">
                <div class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                    <div class="toast-header">
                        <strong class="me-auto">Export Successful!</strong>
                        <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                    </div>
                    <div class="toast-body">
                        Your expense data has been exported successfully.
                    </div>
                </div>
            </div>`;
        document.body.appendChild(toastDiv);

        const toast = new bootstrap.Toast(toastDiv.querySelector('.toast'));
        toast.show();
    } catch (error) {
        console.error('Error exporting data:', error);
        alert('Error exporting data. Please try again.');
    }
}

async function exportToPDF() {
    // First make sure we have the settlement data
    if (!document.querySelector('#settlementResults .card')) {
        alert('Please calculate the settlement first before exporting to PDF.');
        return;
    }
    
    // Store current settlement data for use in PDF export
    const pdfData = {
        settlementsData: null,
        baseCurrency: document.getElementById('baseCurrency').value
    };
    
    // Get the settlement data from the DOM
    try {
        const summaryTable = document.querySelector('#settlementResults .table');
        if (summaryTable) {
            const rows = Array.from(summaryTable.querySelectorAll('tbody tr'));
            pdfData.settlementsData = {};
            
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                const person = cells[0].textContent.trim();
                const balanceText = cells[3].textContent.trim();
                const isPositive = cells[3].classList.contains('text-success');
                const amountText = balanceText.replace(/[^0-9.,]/g, '');
                const amount = parseFloat(amountText) * (isPositive ? 1 : -1);
                pdfData.settlementsData[person] = amount;
            });
        }
    } catch (error) {
        console.error('Error extracting settlement data:', error);
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yPos = 20;

    // Title and basic info
    doc.setFontSize(24);
    doc.setTextColor(44, 62, 80);
    doc.text('Brokewise', 20, yPos);
    yPos += 10;

    doc.setFontSize(16);
    doc.text('Expense Report', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, yPos);
    yPos += 15;

    // Participants section
    doc.setFontSize(14);
    doc.setTextColor(44, 62, 80);
    doc.text('Participants', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    participants.forEach(participant => {
        doc.text(`• ${participant}`, 25, yPos);
        yPos += 6;
    });
    yPos += 10;

    // Expenses section
    doc.setFontSize(14);
    doc.setTextColor(44, 62, 80);
    doc.text('Expenses', 20, yPos);
    yPos += 10;

    const headers = ['Description', 'Paid By', 'Amount', 'Split Between'];
    const colWidths = [50, 45, 30, 45];
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(240, 240, 240);
    doc.rect(20, yPos - 5, 170, 8, 'F');
    headers.forEach((header, i) => {
        let xPos = 20;
        for (let j = 0; j < i; j++) xPos += colWidths[j];
        doc.text(header, xPos + 2, yPos);
    });
    yPos += 8;

    doc.setFontSize(8);
    savedExpenses.forEach(expense => {
        if (yPos > 270) {
            doc.addPage();
            yPos = 20;
        }

        const payers = expense.payers.map(p =>
            `${p.person} (${p.currency} ${addCommasToNumber(p.amount.toFixed(2))})`
        ).join('\n');

        const splits = expense.splits.map(s =>
            `${s.person} (${s.currency} ${addCommasToNumber(s.amount.toFixed(2))})`
        ).join('\n');

        // Calculate total and format with commas and two decimal places
        const totalAmount = expense.payers.reduce((sum, p) => sum + p.amount, 0);
        const displayAmount = `${expense.displayCurrency} ${addCommasToNumber(totalAmount.toFixed(2))}`;

        let xPos = 20;
        doc.text(expense.description, xPos + 2, yPos, { maxWidth: colWidths[0] - 4 });
        xPos += colWidths[0];

        doc.text(payers, xPos + 2, yPos, { maxWidth: colWidths[1] - 4 });
        xPos += colWidths[1];

        doc.text(displayAmount, xPos + 2, yPos);
        xPos += colWidths[2];

        doc.text(splits, xPos + 2, yPos, { maxWidth: colWidths[3] - 4 });

        const lineHeight = Math.max(
            doc.splitTextToSize(expense.description, colWidths[0] - 4).length,
            doc.splitTextToSize(payers, colWidths[1] - 4).length,
            doc.splitTextToSize(splits, colWidths[3] - 4).length
        ) * 4;

        yPos += lineHeight + 4;
    });

    // Add Settlement Summary on a new page
    doc.addPage();
    yPos = 20;

    doc.setFontSize(14);
    doc.setTextColor(44, 62, 80);
    doc.text('Settlement Summary', 20, yPos);
    yPos += 15;

    // Add Summary Table
    const summaryTable = document.querySelector('#settlementResults .table');
    if (summaryTable) {
        const headers = Array.from(summaryTable.querySelectorAll('th')).map(th => th.textContent);
        const rows = Array.from(summaryTable.querySelectorAll('tbody tr')).map(tr =>
            Array.from(tr.querySelectorAll('td')).map(td => td.textContent)
        );

        // Draw table headers
        doc.setFontSize(10);
        doc.setFillColor(240, 240, 240);
        doc.rect(20, yPos - 5, 170, 8, 'F');

        const colWidths = [40, 40, 40, 50];
        headers.forEach((header, i) => {
            let xPos = 20;
            for (let j = 0; j < i; j++) xPos += colWidths[j];
            doc.text(header, xPos + 2, yPos);
        });
        yPos += 10;

        // Draw table rows with proper formatting for the summary
        doc.setFontSize(9);
        
        rows.forEach(row => {
            let xPos = 20;
            
            // First process each cell to extract the right data for display
            const processedRow = row.map((cell, i) => {
                let cellText = cell.trim();
                
                // For the Net Balance column (index 3), format with proper sign
                if (i === 3) {
                    // Check if this is a negative value by examining the cell's class in the original table
                    const rowIndex = rows.indexOf(row);
                    const tableRow = summaryTable.querySelectorAll('tbody tr')[rowIndex];
                    const netBalanceCell = tableRow.querySelectorAll('td')[3];
                    const isNegative = netBalanceCell.classList.contains('text-danger');
                    
                    // Extract just the currency code and numeric amount
                    const currencyMatch = cellText.match(/[A-Z]{3}/);
                    const amountMatch = cellText.match(/[\d,]+\.\d{2}/);
                    
                    if (currencyMatch && amountMatch) {
                        const currency = currencyMatch[0];
                        const amount = amountMatch[0];
                        
                        // Format with appropriate sign
                        if (isNegative) {
                            return `-${currency} ${amount}`;
                        } else {
                            return `+${currency} ${amount}`;
                        }
                    }
                }
                
                return cellText;
            });
            
            // Now print each processed cell
            processedRow.forEach((cellText, i) => {
                doc.text(cellText, xPos + 2, yPos);
                xPos += colWidths[i];
            });
            
            yPos += 7;
        });
        yPos += 10;
    }

    // Settlement Results and Recommended Transfers sections have been removed as requested

    doc.save('brokewise-report.pdf');
}

function addParticipant() {
    const input = document.getElementById('participantInput');
    const name = input.value.trim();

    if (name && !participants.includes(name)) {
        participants.push(name);
        input.value = '';
        updateParticipantList();
        updateAllParticipantSelects();
        saveToBackend();
    }
}

function removeParticipant(name) {
    participants = participants.filter(p => p !== name);
    updateParticipantList();
    updateAllParticipantSelects();
    saveToBackend();
}

function updateParticipantList() {
    const list = document.getElementById('participantList');
    list.innerHTML = participants.map(name =>
        `<span class="badge bg-secondary participant-badge">
            ${name}
            <i class="bi bi-x-circle" onclick="removeParticipant('${name}')"></i>
         </span>`
    ).join('');
}

function updateAllParticipantSelects() {
    document.querySelectorAll('.expense-entry').forEach(expenseEntry => {
        const payerSelects = expenseEntry.querySelectorAll('.payer-entry .payer-select');
        const selectedPayers = Array.from(payerSelects).map(select => select.value);

        payerSelects.forEach(select => {
            const currentValue = select.value;
            select.innerHTML = participants
                .filter(p => p === currentValue || !selectedPayers.includes(p))
                .map(p => `<option value="${p}">${p}</option>`)
                .join('');
            select.value = currentValue;
        });

        const splitSelects = expenseEntry.querySelectorAll('.split-entry .split-select');
        const selectedSplits = Array.from(splitSelects).map(select => select.value);

        splitSelects.forEach(select => {
            const currentValue = select.value;
            select.innerHTML = participants
                .filter(p => p === currentValue || !selectedSplits.includes(p))
                .map(p => `<option value="${p}">${p}</option>`)
                .join('');
            select.value = currentValue;
        });
    });
}

function addExpenseRow() {
    const template = document.getElementById('expenseTemplate');
    const expenseList = document.getElementById('expenseList');
    const clone = template.content.cloneNode(true);

    const displayCurrencySelect = clone.querySelector('.display-currency-select');
    displayCurrencySelect.innerHTML = currencyOptions;

    expenseList.appendChild(clone);

    const expenseEntry = expenseList.lastElementChild;
    addPayer(expenseEntry.querySelector('.payers-list').nextElementSibling);
    addSplit(expenseEntry.querySelector('.splits-list').nextElementSibling);
    updateAllParticipantSelects();
}

function addPayer(btn) {
    const template = document.getElementById('payerTemplate');
    const payersList = btn.previousElementSibling;
    const clone = template.content.cloneNode(true);

    const currentPayers = Array.from(payersList.querySelectorAll('.payer-select')).map(select => select.value);

    const select = clone.querySelector('.payer-select');
    select.innerHTML = participants
        .filter(p => !currentPayers.includes(p))
        .map(p => `<option value="${p}">${p}</option>`)
        .join('');

    if (select.options.length > 0) {
        payersList.appendChild(clone);
        updateAllParticipantSelects();
        updateTotals(select);
    } else {
        alert('All participants have been added as payers');
    }
}

function addSplit(btn) {
    const template = document.getElementById('splitTemplate');
    const splitsList = btn.previousElementSibling;
    const clone = template.content.cloneNode(true);

    const currentSplits = Array.from(splitsList.querySelectorAll('.split-select')).map(select => select.value);

    const select = clone.querySelector('.split-select');
    select.innerHTML = participants
        .filter(p => !currentSplits.includes(p))
        .map(p => `<option value="${p}">${p}</option>`)
        .join('');

    if (select.options.length > 0) {
        splitsList.appendChild(clone);
        updateAllParticipantSelects();
        updateTotals(select);
    } else {
        alert('All participants have been added to the split');
    }
}

function removePayer(btn) {
    const payerEntry = btn.closest('.payer-entry');
    const payersList = payerEntry.parentElement;
    payerEntry.remove();
    updateTotals(payersList);

    if (payersList.children.length === 0) {
        addPayer(payersList.nextElementSibling);
    }
}

function removeSplit(btn) {
    const splitEntry = btn.closest('.split-entry');
    const splitsList = splitEntry.parentElement;
    splitEntry.remove();
    updateTotals(splitsList);

    if (splitsList.children.length === 0) {
        addSplit(splitsList.nextElementSibling);
    }
}

function removeExpense(btn) {
    const expenseEntry = btn.closest('.expense-entry');
    expenseEntry.remove();
}

async function getExchangeRate(fromCurrency, toCurrency) {
    try {
        const response = await fetch(`/api/exchange-rate?from=${fromCurrency}&to=${toCurrency}`);
        const data = await response.json();
        return data.rate;
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
        return 1.0;
    }
}

async function updateTotals(element) {
    const expenseEntry = element.closest('.expense-entry');
    const saveBtn = expenseEntry.querySelector('.btn-success');
    saveBtn.disabled = true;

    const displayCurrency = expenseEntry.querySelector('.display-currency-select').value;
    let totalPaid = 0;
    let totalSplit = 0;

    for (const payerEntry of expenseEntry.querySelectorAll('.payer-entry')) {
        const amount = parseFloat(payerEntry.querySelector('.amount-input').value) || 0;
        const currency = payerEntry.querySelector('.currency-select').value;
        const rate = await getExchangeRate(currency, displayCurrency);
        totalPaid += amount * rate;
    }

    for (const splitEntry of expenseEntry.querySelectorAll('.split-entry')) {
        const amount = parseFloat(splitEntry.querySelector('.amount-input').value) || 0;
        const currency = splitEntry.querySelector('.currency-select').value;
        const rate = await getExchangeRate(currency, displayCurrency);
        totalSplit += amount * rate;
    }

    // Format amounts with commas and always 2 decimal places
    const formattedTotalPaid = totalPaid.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const formattedTotalSplit = totalSplit.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    
    expenseEntry.querySelector('.total-paid').textContent =
        `${displayCurrency} ${formattedTotalPaid}`;
    expenseEntry.querySelector('.total-split').textContent =
        `${displayCurrency} ${formattedTotalSplit}`;

    const warning = expenseEntry.querySelector('.amounts-mismatch-warning');
    const amountsMatch = Math.abs(totalPaid - totalSplit) <= 0.01;
    warning.style.display = amountsMatch ? 'none' : 'block';
    saveBtn.disabled = !amountsMatch;
}

function saveExpense(btn) {
    const expenseEntry = btn.closest('.expense-entry');
    const description = expenseEntry.querySelector('input[type="text"]').value;
    const displayCurrency = expenseEntry.querySelector('.display-currency-select').value;

    // Validate description
    if (!description.trim()) {
        showErrorToast('Please enter a description for the expense.');
        return;
    }

    // Calculate total amounts and validate payers
    let totalPaid = 0;
    const payers = Array.from(expenseEntry.querySelectorAll('.payer-entry')).map(payerEntry => {
        const amount = parseFloat(payerEntry.querySelector('.amount-input').value);
        if (isNaN(amount) || amount <= 0) {
            showErrorToast('Please enter valid positive amounts for all payers.');
            return null;
        }
        totalPaid += amount;
        return {
            person: payerEntry.querySelector('.payer-select').value,
            amount: amount,
            currency: payerEntry.querySelector('.currency-select').value
        };
    });

    // If any payer has invalid amount, stop the save process
    if (payers.includes(null)) return;

    // Check splits and validate amounts
    let totalSplit = 0;
    const splits = Array.from(expenseEntry.querySelectorAll('.split-entry')).map(splitEntry => {
        const amount = parseFloat(splitEntry.querySelector('.amount-input').value);
        if (isNaN(amount) || amount <= 0) {
            showErrorToast('Please enter valid positive amounts for all splits.');
            return null;
        }
        totalSplit += amount;
        return {
            person: splitEntry.querySelector('.split-select').value,
            amount: amount,
            currency: splitEntry.querySelector('.currency-select').value
        };
    });

    // If any split has invalid amount, stop the save process
    if (splits.includes(null)) return;

    // Check if amounts match
    if (Math.abs(totalPaid - totalSplit) > 0.01) {
        showErrorToast('The total amount paid must equal the total amount split.');
        return;
    }

    const expense = {
        id: Date.now(),
        description,
        displayCurrency,
        payers,
        splits,
        date: new Date().toISOString()
    };

    savedExpenses.push(expense);
    saveToBackend();
    updateExpenseTable();
    expenseEntry.remove();
    showSuccessToast('Expense saved successfully!');
}


// Helper function to show error toast
function showErrorToast(message) {
    const toastDiv = document.createElement('div');
    toastDiv.innerHTML = `
        <div class="toast-container position-fixed bottom-0 end-0 p-3">
            <div class="toast bg-danger text-white" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header bg-danger text-white">
                    <strong class="me-auto">Error</strong>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">
                    ${message}
                </div>
            </div>
        </div>`;
    document.body.appendChild(toastDiv);
    const toast = new bootstrap.Toast(toastDiv.querySelector('.toast'));
    toast.show();
}

// Helper function to show success toast
function showSuccessToast(message) {
    const toastDiv = document.createElement('div');
    toastDiv.innerHTML = `
        <div class="toast-container position-fixed bottom-0 end-0 p-3">
            <div class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header">
                    <strong class="me-auto">Success</strong>
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">${message}</div>
            </div>
        </div>`;
    document.body.appendChild(toastDiv);
    const toast = new bootstrap.Toast(toastDiv.querySelector('.toast'));
    toast.show();
}

function deleteExpense(id) {
    if (confirm('Are you sure you want to delete this expense?')) {
        savedExpenses = savedExpenses.filter(e => e.id !== id);
        saveToBackend();
        updateExpenseTable();
    }
}

async function updateExpenseTable() {
    const tbody = document.getElementById('expenseTableBody');
    const mobileCardView = document.getElementById('expenseMobileCards');
    const isMobile = window.innerWidth < 768; // Bootstrap's md breakpoint
    
    // Process all expenses to gather the formatted data
    const processedExpenses = await Promise.all(savedExpenses.map(async expense => {
        const displayCurrency = expense.displayCurrency;

        const payersWithConvertedAmounts = await Promise.all(expense.payers.map(async p => {
            const rate = await getExchangeRate(p.currency, displayCurrency);
            const convertedAmount = p.amount * rate;
            // Format amount with commas and always 2 decimal places
            const formattedAmount = p.amount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            return {
                ...p,
                convertedAmount,
                originalAmount: `${p.currency} ${formattedAmount}`
            };
        }));

        const splitsWithConvertedAmounts = await Promise.all(expense.splits.map(async s => {
            const rate = await getExchangeRate(s.currency, displayCurrency);
            const convertedAmount = s.amount * rate;
            // Format amount with commas and always 2 decimal places
            const formattedAmount = s.amount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            return {
                ...s,
                convertedAmount,
                originalAmount: `${s.currency} ${formattedAmount}`
            };
        }));

        // Display only person names for "Who Paid" column (no amounts in parentheses)
        const payersText = payersWithConvertedAmounts.map(p => p.person).join(', ');

        // Format "Split Between" as a more organized list with line breaks between participants
        const splitsText = splitsWithConvertedAmounts.map(s =>
            `<div class="split-item mb-1">${s.person} <span class="text-muted">(${s.originalAmount})</span></div>`
        ).join('');

        const totalPaidConverted = payersWithConvertedAmounts.reduce((sum, p) => sum + p.convertedAmount, 0);
        
        // Format amount with commas and always 2 decimal places
        const formattedAmount = totalPaidConverted.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        return {
            id: expense.id,
            description: expense.description,
            payersText: payersText,
            splitsText: splitsText,
            displayCurrency: displayCurrency,
            formattedAmount: formattedAmount
        };
    }));
    
    // Update the desktop table view
    const tableRows = processedExpenses.map(expense => `
        <tr>
            <td>${expense.description}</td>
            <td>${expense.payersText}</td>
            <td>${expense.displayCurrency} ${expense.formattedAmount}</td>
            <td>${expense.displayCurrency}</td>
            <td>${expense.splitsText}</td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-primary" onclick="editExpense(${expense.id})">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteExpense(${expense.id})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `);
    
    tbody.innerHTML = tableRows.join('');
    
    // Update the mobile card view
    const mobileCards = processedExpenses.map(expense => `
        <div class="card mb-3 expense-card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0">${expense.description}</h5>
                <div class="badge bg-primary">${expense.displayCurrency} ${expense.formattedAmount}</div>
            </div>
            <div class="card-body">
                <div class="mb-3">
                    <div class="text-muted mb-1"><small>Who Paid</small></div>
                    <div class="fw-medium">${expense.payersText}</div>
                </div>
                <div class="mb-3">
                    <div class="text-muted mb-1"><small>Split Between</small></div>
                    <div>${expense.splitsText}</div>
                </div>
            </div>
            <div class="card-footer bg-light">
                <div class="d-flex justify-content-end">
                    <div class="btn-group">
                        <button class="btn btn-sm btn-primary" onclick="editExpense(${expense.id})">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteExpense(${expense.id})">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);
    
    mobileCardView.innerHTML = mobileCards.join('');
    
    // Toggle visibility based on screen size
    const tableContainer = document.getElementById('expenseTableContainer');
    const cardContainer = document.getElementById('expenseMobileContainer');
    
    if (isMobile) {
        tableContainer.classList.add('d-none');
        cardContainer.classList.remove('d-none');
    } else {
        tableContainer.classList.remove('d-none');
        cardContainer.classList.add('d-none');
    }
}

function editExpense(id) {
    const expense = savedExpenses.find(e => e.id === id);
    if (!expense) return;

    if (!confirm('Do you want to edit this expense?')) {
        return;
    }

    // Switch to add expenses tab
    document.getElementById('add-expenses-tab').click();

    // Add a new expense form
    addExpenseRow();
    const expenseEntry = document.querySelector('.expense-entry:last-child');

    // Fill in the description
    expenseEntry.querySelector('.expense-description').value = expense.description;
    expenseEntry.querySelector('.display-currency-select').value = expense.displayCurrency;

    // Add payers
    const payersList = expenseEntry.querySelector('.payers-list');
    payersList.innerHTML = '';
    expense.payers.forEach(payer => {
        const template = document.getElementById('payerTemplate');
        const clone = template.content.cloneNode(true);

        clone.querySelector('.payer-select').innerHTML = participants
            .map(p => `<option value="${p}"${p === payer.person ? ' selected' : ''}>${p}</option>`)
            .join('');

        clone.querySelector('.amount-input').value = payer.amount;
        clone.querySelector('.currency-select').value = payer.currency;

        payersList.appendChild(clone);
    });

    // Add splits
    const splitsList = expenseEntry.querySelector('.splits-list');
    splitsList.innerHTML = '';
    expense.splits.forEach(split => {
        const template = document.getElementById('splitTemplate');
        const clone = template.content.cloneNode(true);

        clone.querySelector('.split-select').innerHTML = participants
            .map(p => `<option value="${p}"${p === split.person ? ' selected' : ''}>${p}</option>`)
            .join('');

        clone.querySelector('.amount-input').value = split.amount;
        clone.querySelector('.currency-select').value = split.currency;

        splitsList.appendChild(clone);
    });

    // Delete the old expense
    savedExpenses = savedExpenses.filter(e => e.id !== id);
    saveToBackend();

    // Update totals
    updateTotals(expenseEntry.querySelector('.display-currency-select'));
}



// Global variable to store settlement data for PDF export - prevents issues with formatted numbers
window.settlementData = {
    settlements: {},
    transfers: [],
    baseCurrency: "USD"
};

// Helper function to safely add commas to numbers for PDF display
function addCommasToNumber(numStr) {
    // Add commas to the whole number portion, preserve decimal part
    const parts = numStr.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

async function calculateSettlement() {
    const baseCurrency = document.getElementById('baseCurrency').value;

    fetch('/calculate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            participants,
            expenses: savedExpenses,
            baseCurrency
        })
    })
    .then(response => response.json())
    .then(data => {
        // Store the raw settlement data for PDF export
        window.settlementData = {
            settlements: {...data.settlements}, // Copy the raw settlement values
            transfers: [], // Will be populated below
            baseCurrency: baseCurrency
        };
        const resultsDiv = document.getElementById('settlementResults');
        resultsDiv.innerHTML = '';

        // Build the summary card
        let summaryCardHTML = `
            <div class="card mb-4">
                <div class="card-header bg-light">
                    <h5 class="mb-0 d-flex align-items-center">
                        <i class="bi bi-table me-2"></i>
                        <span>Summary</span>
                    </h5>
                </div>
                <div class="card-body">
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Participant</th>
                                    <th>Total Paid</th>
                                    <th>Should Pay</th>
                                    <th>Net Balance</th>
                                </tr>
                            </thead>
                            <tbody>`;
                            
        Object.entries(data.settlements).forEach(([person, amount]) => {
            const totalPaid = savedExpenses.reduce((sum, exp) => {
                const personPaid = exp.payers
                    .filter(p => p.person === person)
                    .reduce((psum, p) => psum + (p.amount || 0), 0);
                return sum + personPaid;
            }, 0);

            const shouldPay = totalPaid - amount;

            summaryCardHTML += `
                <tr>
                    <td>${person}</td>
                    <td>${baseCurrency} ${totalPaid.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td>${baseCurrency} ${shouldPay.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td class="${amount >= 0 ? 'text-success' : 'text-danger'}">
                        ${baseCurrency} ${amount >= 0 ? '+' : '-'}${Math.abs(amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                </tr>`;
        });
                            
        summaryCardHTML += `
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;
            
        // Add summary card to results div
        resultsDiv.innerHTML += summaryCardHTML;

        // Build the settlement results card
        let settlementCardHTML = `
            <div class="card mt-4">
                <div class="card-header bg-light">
                    <h5 class="mb-0 d-flex align-items-center">
                        <i class="bi bi-cash-stack me-2"></i>
                        <span>Settlement Results</span>
                    </h5>
                </div>
                <div class="card-body">`;
                
        // Add each person's settlement result
        Object.entries(data.settlements).forEach(([person, amount]) => {
            const amountClass = amount >= 0 ? 'positive-amount' : 'negative-amount';
            settlementCardHTML += `
                <div class="mb-2">
                    <strong>${person}:</strong>
                    <span class="${amountClass}">
                        ${amount >= 0 ? 'Gets back' : 'Owes'}
                        ${baseCurrency} ${amount >= 0 ? '+' : '-'}${Math.abs(amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                </div>`;
        });

        // Close the settlement results card
        settlementCardHTML += `
                </div>
            </div>`;
            
        // Add settlement card to results div
        resultsDiv.innerHTML += settlementCardHTML;

        const settlements = data.settlements;
        const debtors = Object.entries(settlements)
            .filter(([_, amount]) => amount < 0)
            .sort((a, b) => a[1] - b[1]);
        const creditors = Object.entries(settlements)
            .filter(([_, amount]) => amount > 0)
            .sort((a, b) => b[1] - a[1]);

        if (creditors.length > 0 && debtors.length > 0) {
            // Build the recommended transfers card
            let transfersCardHTML = `
                <div class="card mt-4">
                    <div class="card-header bg-light">
                        <h5 class="mb-0 d-flex align-items-center">
                            <i class="bi bi-lightbulb me-2"></i>
                            <span>Recommended Transfers</span>
                        </h5>
                    </div>
                    <div class="card-body">
                        <p class="text-muted small mb-3">Here's the most efficient way to settle all debts:</p>`;

            const mainCreditor = creditors[0];
            // Store transfers for PDF export
            window.settlementData.transfers = [];
            
            debtors.forEach(([debtor, amount]) => {
                // Store raw transfer data for PDF export (no formatting)
                window.settlementData.transfers.push({
                    from: debtor,
                    to: mainCreditor[0],
                    amount: Math.abs(amount),
                    currency: baseCurrency
                });
                
                transfersCardHTML += `
                    <div class="mb-2">
                        <strong>${debtor}</strong> pays 
                        <strong>${mainCreditor[0]}</strong>: 
                        ${baseCurrency} ${Math.abs(amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>`;
            });

            for (let i = 1; i < creditors.length; i++) {
                const [creditor, amount] = creditors[i];
                
                // Store raw transfer data for PDF export (no formatting)
                window.settlementData.transfers.push({
                    from: mainCreditor[0],
                    to: creditor,
                    amount: amount, 
                    currency: baseCurrency
                });
                
                transfersCardHTML += `
                    <div class="mb-2">
                        <strong>${mainCreditor[0]}</strong> pays 
                        <strong>${creditor}</strong>: 
                        ${baseCurrency} ${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>`;
            }

            transfersCardHTML += `
                    </div>
                </div>`;
                
            // Add transfers card to results div
            resultsDiv.innerHTML += transfersCardHTML;
        }

        const exchangeRateInfo = document.getElementById('exchangeRateInfo');
        const timestamp = new Date(data.exchangeRateInfo.timestamp * 1000).toLocaleString();
        exchangeRateInfo.innerHTML = `
            <i class="bi bi-info-circle me-1"></i>
            Exchange rates provided by ${data.exchangeRateInfo.source}, 
            last updated: ${timestamp}
        `;
    });
}

const currencyOptions = `
    <option value="USD">USD - US Dollar</option>
    <option value="EUR">EUR - Euro</option>
    <option value="JPY">JPY - Japanese Yen</option>
    <option value="GBP">GBP - British Pound</option>
    <option value="CNY">CNY - Chinese Yuan</option>
    <option value="AUD">AUD - Australian Dollar</option>
    <option value="CAD">CAD - Canadian Dollar</option>
    <option value="CHF">CHF - Swiss Franc</option>
    <option value="HKD">HKD - Hong Kong Dollar</option>
    <option value="SGD">SGD - Singapore Dollar</option>
    <option value="SEK">SEK - Swedish Krona</option>
    <option value="KRW">KRW - South Korean Won</option>
    <option value="INR">INR - Indian Rupee</option>
    <option value="BRL">BRL - Brazilian Real</option>
    <option value="RUB">RUB - Russian Ruble</option>
    <option value="ZAR">ZAR - South African Rand</option>
    <option value="MXN">MXN - Mexican Peso</option>
    <option value="IDR">IDR - Indonesian Rupiah</option>
    <option value="TRY">TRY - Turkish Lira</option>
    <option value="SAR">SAR - Saudi Riyal</option>
    `;

document.querySelectorAll('template').forEach(template => {
    const currencySelects = template.content.querySelectorAll('.currency-select');
    currencySelects.forEach(select => {
        select.innerHTML = currencyOptions;
    });
});

document.addEventListener('change', async event => {
    if (event.target.classList.contains('display-currency-select') ||
        event.target.classList.contains('amount-input') ||
        event.target.classList.contains('currency-select')) {
        await updateTotals(event.target);
    }
});

async function splitEvenly(btn) {
    const expenseEntry = btn.closest('.expense-entry');
    const displayCurrency = expenseEntry.querySelector('.display-currency-select').value;

    // Calculate total paid amount in display currency
    let totalPaid = 0;
    for (const payerEntry of expenseEntry.querySelectorAll('.payer-entry')) {
        const amount = parseFloat(payerEntry.querySelector('.amount-input').value) || 0;
        const currency = payerEntry.querySelector('.currency-select').value;
        const rate = await getExchangeRate(currency, displayCurrency);
        totalPaid += amount * rate;
    }

    // Get all split entries
    const splitEntries = expenseEntry.querySelectorAll('.split-entry');
    if (splitEntries.length === 0) {
        alert('Please add participants to split between first');
        return;
    }

    // Calculate exact even split amount
    const exactEvenAmount = totalPaid / splitEntries.length;
    const roundedEvenAmount = Math.floor(exactEvenAmount * 100) / 100; // Round down to 2 decimals

    // Calculate total after rounding
    const totalAfterRounding = roundedEvenAmount * (splitEntries.length - 1);

    // Calculate the remaining amount for the first person
    const firstPersonAmount = (totalPaid - totalAfterRounding).toFixed(2);

    // Update all split amounts
    splitEntries.forEach((splitEntry, index) => {
        const amountInput = splitEntry.querySelector('.amount-input');
        const currencySelect = splitEntry.querySelector('.currency-select');

        // First person gets the adjusted amount, others get the rounded even amount
        amountInput.value = index ===0 ? firstPersonAmount : roundedEvenAmount.toFixed(2);
        currencySelect.value = displayCurrency;
    });

    // Update totals
    await updateTotals(btn);
}