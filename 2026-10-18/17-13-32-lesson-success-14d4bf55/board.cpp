#include <iostream>
#include <vector>
#include <sstream>

int main() {
    // Step 1 & 2: Read list of numbers from stdin
    std::string line;
    if (!std::getline(std::cin, line)) {
        return 0;
    }
    
    std::stringstream ss(line);
    std::vector<int> numbers;
    int num;
    while (ss >> num) {
        numbers.push_back(num);
    }

    if (numbers.empty()) {
        return 0;
    }

    // Step 3: Assume the first number is the largest.
    int largest = numbers[0];

    // Step 4: For each remaining number in the list:
    // If the current number is greater than your largest, update your largest.
    for (size_t i = 1; i < numbers.size(); ++i) {
        if (numbers[i] > largest) {
            largest = numbers[i];
        }
    }

    // Step 5: Display the largest number.
    std::cout << largest << std::endl;

    // Step 6: Stop
    return 0;
}
